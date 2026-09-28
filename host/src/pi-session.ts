import fs from "node:fs";
import path from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import { BROWSER_SYSTEM_PROMPT, BROWSER_TOOL_NAMES, createBrowserTools, type BrowserBridge } from "./browser-tools.js";
import { pickInitialModel, resolvePandapiHome, type AgentEvent, type TabContext } from "./protocol.js";
import { tryConnectStagehand, type StagehandHandle } from "./stagehand.js";

export type PiController = {
  models: Array<{ provider: string; id: string; name?: string }>;
  model: { provider: string; id: string } | null;
  stagehand: boolean;
  warning?: string;
  prompt: (id: string, text: string, tab: TabContext | null, emit: (e: AgentEvent) => void) => Promise<void>;
  abort: () => Promise<void>;
  newSession: () => Promise<void>;
  setModel: (provider: string, modelId: string) => Promise<void>;
  dispose: () => Promise<void>;
};

function eventText(event: { type: string; [k: string]: unknown }): AgentEvent | null {
  if (event.type === "message_update") {
    const inner = event.assistantMessageEvent as { type?: string; delta?: string } | undefined;
    if (inner?.type === "text_delta" && inner.delta) {
      return { type: "text_delta", text: inner.delta };
    }
    return null;
  }
  if (event.type === "message_end") {
    const message = event.message as { stopReason?: string; errorMessage?: string } | undefined;
    if (message?.stopReason === "error" && message.errorMessage) {
      return { type: "error", message: message.errorMessage };
    }
    if (message?.stopReason === "aborted") {
      return { type: "error", message: "Aborted." };
    }
    return null;
  }
  if (event.type === "tool_execution_start") {
    return {
      type: "tool_start",
      name: String(event.toolName ?? event.name ?? "tool"),
      detail: event.args ? JSON.stringify(event.args).slice(0, 300) : undefined,
    };
  }
  if (event.type === "tool_execution_end") {
    return {
      type: "tool_end",
      name: String(event.toolName ?? "tool"),
      detail: event.isError ? "failed" : undefined,
    };
  }
  return null;
}

export async function createPiController(bridge: BrowserBridge): Promise<PiController> {
  // Everything PandaPi owns lives under this one directory. It is NOT
  // ~/.pi/agent, so the browser agent and the Pi CLI stay fully independent.
  const agentHome = resolvePandapiHome();
  fs.mkdirSync(agentHome, { recursive: true });

  const authPath = path.join(agentHome, "auth.json");
  const modelsPath = path.join(agentHome, "models.json");
  const modelsStorePath = path.join(agentHome, "models-store.json");
  const modelRuntime = await ModelRuntime.create({
    authPath,
    modelsPath,
    modelsStorePath,
    // Populate PandaPi's own model catalog on first run, then reuse the cache.
    allowModelNetwork: !fs.existsSync(modelsStorePath),
    modelRefreshTimeoutMs: 8000,
  });
  const available = await modelRuntime.getAvailable();
  const models = available.map((m) => ({
    provider: m.provider,
    id: m.id,
    name: (m as { name?: string }).name,
  }));

  let warning: string | undefined;
  if (models.length === 0) {
    warning = `No API key found for PandaPi. Add one at ${authPath} (run "bun run set-key" in the PandaPi repo). PandaPi keeps its own key, separate from the Pi CLI.`;
  }

  let currentTab: TabContext | null = null;
  let stagehand: StagehandHandle | null = await tryConnectStagehand();
  let session: AgentSession | undefined;

  const tools = createBrowserTools({
    getTab: () => currentTab,
    bridge,
    getStagehand: () => stagehand,
    supportsImages: () => Boolean(session?.model?.input?.includes("image")),
  });

  const loader = new DefaultResourceLoader({
    cwd: agentHome,
    agentDir: agentHome,
    systemPromptOverride: () => BROWSER_SYSTEM_PROMPT,
  } as ConstructorParameters<typeof DefaultResourceLoader>[0]);
  await loader.reload();

  // PandaPi's own settings (default provider/model). No CLI settings are read.
  const settings = SettingsManager.create(agentHome, agentHome);
  const picked = pickInitialModel(available, {
    provider: settings.getDefaultProvider(),
    id: settings.getDefaultModel(),
  });

  let unsubscribe: (() => void) | undefined;
  let emitCurrent: ((e: AgentEvent) => void) | undefined;

  async function rebuildSession(model = picked) {
    unsubscribe?.();
    session?.dispose();
    const result = await createAgentSession({
      cwd: agentHome,
      agentDir: agentHome,
      model,
      modelRuntime,
      thinkingLevel: "off",
      noTools: "builtin",
      tools: [...BROWSER_TOOL_NAMES],
      excludeTools: ["bash", "read", "write", "edit", "grep", "find", "ls"],
      customTools: tools,
      resourceLoader: loader,
      sessionManager: SessionManager.inMemory(),
    });
    session = result.session;
    unsubscribe = session.subscribe((event) => {
      const mapped = eventText(event as unknown as { type: string; [k: string]: unknown });
      if (mapped) emitCurrent?.(mapped);
    });
  }

  if (picked) {
    await rebuildSession(picked);
  }

  return {
    models,
    model: picked ? { provider: picked.provider, id: picked.id } : null,
    stagehand: Boolean(stagehand),
    warning,
    async prompt(id, text, tab, emit) {
      if (!session) {
        emit({ type: "error", message: warning ?? "Pi session is not ready." });
        emit({ type: "done" });
        return;
      }
      currentTab = tab;
      emitCurrent = emit;
      const prefix = tab
        ? `[Attached tab ${tab.tabId}] ${tab.title}\n${tab.url}\n\n`
        : "[No attached tab]\n\n";
      try {
        await session.prompt(prefix + text);
      } catch (err) {
        emit({ type: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        emit({ type: "done" });
        emitCurrent = undefined;
      }
    },
    async abort() {
      await session?.abort();
    },
    async newSession() {
      if (picked) await rebuildSession(session?.model ?? picked);
    },
    async setModel(provider, modelId) {
      const model = modelRuntime.getModel(provider, modelId) ?? available.find((m) => m.provider === provider && m.id === modelId);
      if (!model) throw new Error(`Unknown model ${provider}/${modelId}`);
      if (session) {
        await session.setModel(model);
      } else {
        await rebuildSession(model);
      }
    },
    async dispose() {
      unsubscribe?.();
      session?.dispose();
      await stagehand?.close();
    },
  };
}
