import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import { BROWSER_SYSTEM_PROMPT, BROWSER_TOOL_NAMES, createBrowserTools, type ApprovalFn, type BrowserBridge, type SnapshotBinding } from "./browser-tools.js";
import {
  pandapiHome,
  modelsPath,
  authPath,
  ensureHome,
  seedFromEnv,
  writeLlmConfig,
  readLlmConfig,
  publicConfig,
  PROVIDER_ID,
  type LlmConfig,
} from "./config.js";
import type { AgentEvent, PublicLlm, TabContext } from "./protocol.js";

export type PiController = {
  models: Array<{ provider: string; id: string; name?: string }>;
  model: { provider: string; id: string } | null;
  llm: PublicLlm;
  warning?: string;
  prompt: (id: string, text: string, tab: TabContext | null, emit: (e: AgentEvent) => void) => Promise<void>;
  abort: () => Promise<void>;
  newSession: () => Promise<void>;
  setModel: (provider: string, modelId: string) => Promise<void>;
  setConfig: (baseUrl: string, apiKey: string, modelId: string) => Promise<void>;
  dispose: () => Promise<void>;
};

function eventText(event: { type: string; [k: string]: unknown }): AgentEvent | null {
  if (event.type === "message_update") {
    const inner = event.assistantMessageEvent as {
      type?: string;
      delta?: string;
      text?: string;
      error?: { errorMessage?: string; stopReason?: string };
      reason?: string;
    } | undefined;
    if (inner?.type === "error") {
      const msg =
        inner.error?.errorMessage ||
        inner.reason ||
        "LLM request failed. Check base URL, model id, and API key.";
      return { type: "error", message: String(msg) };
    }
    const delta = inner?.delta || (inner?.type === "text" ? inner.text : undefined);
    if (delta) return { type: "text_delta", text: delta };
  }
  if (event.type === "message_end") {
    const message = event.message as {
      errorMessage?: string;
      stopReason?: string;
      content?: Array<{ type?: string; text?: string }>;
    } | undefined;
    if (message?.errorMessage) return { type: "error", message: message.errorMessage };
    if (message?.stopReason === "error") {
      return { type: "error", message: "LLM returned an error (no details)." };
    }
  }
  if (event.type === "tool_execution_start") {
    return {
      type: "tool_start",
      name: String(event.toolName ?? event.name ?? "tool"),
      detail: event.args ? JSON.stringify(event.args).slice(0, 300) : undefined,
    };
  }
  if (event.type === "tool_call") {
    return { type: "tool_start", name: String(event.toolName ?? "tool") };
  }
  if (event.type === "tool_execution_end" || event.type === "tool_result") {
    const err = event.isError ? ` error: ${JSON.stringify(event.result).slice(0, 200)}` : "";
    return { type: "tool_end", name: String(event.toolName ?? event.name ?? "tool"), detail: err || undefined };
  }
  if (event.type === "auto_retry_start") {
    return {
      type: "error",
      message: `Retrying LLM (${String(event.attempt)}/${String(event.maxAttempts)}): ${String(event.errorMessage ?? "")}`,
    };
  }
  if (event.type === "agent_end") return null;
  if (event.type === "error" || event.type === "agent_error") {
    return { type: "error", message: String(event.error ?? event.message ?? "Agent error") };
  }
  return null;
}

export async function createPiController(opts: {
  bridge: BrowserBridge;
  requestApproval: ApprovalFn;
}): Promise<PiController> {
  const { bridge, requestApproval } = opts;
  const home = ensureHome(pandapiHome());
  let cfg = seedFromEnv(home) ?? readLlmConfig(home);
  if (cfg) writeLlmConfig(cfg, home);

  let modelRuntime = await ModelRuntime.create({
    authPath: authPath(home),
    modelsPath: modelsPath(home),
  });

  let available = await modelRuntime.getAvailable();
  const summarize = () =>
    available.map((m) => ({
      provider: m.provider,
      id: m.id,
      name: (m as { name?: string }).name,
    }));

  let models = summarize();
  let warning: string | undefined;
  if (models.length === 0) {
    warning =
      "No LLM key yet. Open Settings in this panel and add an OpenAI-compatible base URL + API key. Keys stay in ~/.pandapi, not ~/.pi.";
  }

  let currentTab: TabContext | null = null;
  let snapshot: SnapshotBinding | null = null;

  const tools = createBrowserTools({
    getTab: () => currentTab,
    bridge,
    requestApproval,
    getSnapshot: () => snapshot,
    setSnapshot: (next) => {
      snapshot = next;
    },
  });

  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: true },
  });

  const loader = new DefaultResourceLoader({
    cwd: home,
    agentDir: home,
    settingsManager,
    systemPromptOverride: () => BROWSER_SYSTEM_PROMPT,
    skillsOverride: () => ({ skills: [], diagnostics: [] }),
    agentsFilesOverride: () => ({ agentsFiles: [] }),
    extensionFactories: [],
  } as ConstructorParameters<typeof DefaultResourceLoader>[0]);
  await loader.reload();

  let session: AgentSession | undefined;
  let unsubscribe: (() => void) | undefined;
  let emitCurrent: ((e: AgentEvent) => void) | undefined;

  const pickModel = () => {
    if (cfg) {
      return modelRuntime.getModel(PROVIDER_ID, cfg.modelId) ?? available[0];
    }
    return available[0];
  };

  async function rebuildSession() {
    unsubscribe?.();
    session?.dispose();
    available = await modelRuntime.getAvailable();
    models = summarize();
    const model = pickModel();
    if (!model) {
      session = undefined;
      return;
    }
    const result = await createAgentSession({
      cwd: home,
      agentDir: home,
      model,
      modelRuntime,
      thinkingLevel: "off",
      noTools: "builtin",
      tools: [...BROWSER_TOOL_NAMES],
      excludeTools: ["bash", "read", "write", "edit", "grep", "find", "ls", "powershell"],
      customTools: tools,
      resourceLoader: loader,
      sessionManager: SessionManager.inMemory(),
      settingsManager,
    });
    session = result.session;
    unsubscribe = session.subscribe((event) => {
      const mapped = eventText(event as unknown as { type: string; [k: string]: unknown });
      if (mapped) emitCurrent?.(mapped);
    });
  }

  await rebuildSession();

  return {
    get models() {
      return models;
    },
    get model() {
      const m = session?.model ?? pickModel();
      return m ? { provider: m.provider, id: m.id } : null;
    },
    get llm() {
      return publicConfig(cfg);
    },
    get warning() {
      return warning;
    },
    async prompt(id, text, tab, emit) {
      if (!session) {
        emit({ type: "error", message: warning ?? "Pi session is not ready. Add an API key in Settings." });
        emit({ type: "done" });
        return;
      }
      currentTab = tab;
      snapshot = null;
      let saw = false;
      emitCurrent = (e) => {
        if (e.type !== "done") saw = true;
        emit(e);
      };
      emit({ type: "text_delta", text: "Working…\n" });
      const prefix = tab
        ? `[Attached tab ${tab.tabId}] ${tab.title}\n${tab.url}\n\n`
        : "[No attached tab]\n\n";
      try {
        await session.prompt(prefix + text);
      } catch (err) {
        emit({ type: "error", message: err instanceof Error ? err.message : String(err) });
        saw = true;
      } finally {
        if (!saw) {
          emit({
            type: "error",
            message:
              "The model returned nothing. Confirm the OpenAI-compatible base URL, that model id is exact (e.g. big-pickle), and the server accepts chat completions with tools.",
          });
        }
        emit({ type: "done" });
        emitCurrent = undefined;
      }
    },
    async abort() {
      await session?.abort();
    },
    async newSession() {
      snapshot = null;
      await rebuildSession();
    },
    async setModel(provider, modelId) {
      const model =
        modelRuntime.getModel(provider, modelId) ?? available.find((m) => m.provider === provider && m.id === modelId);
      if (!model) throw new Error(`Unknown model ${provider}/${modelId}`);
      if (cfg && provider === PROVIDER_ID) {
        cfg = { ...cfg, modelId };
        writeLlmConfig(cfg, home);
      }
      if (session) await session.setModel(model);
      else await rebuildSession();
    },
    async setConfig(baseUrl, apiKey, modelId) {
      const prev = readLlmConfig(home);
      const next: LlmConfig = {
        providerId: PROVIDER_ID,
        baseUrl: baseUrl.trim() || prev?.baseUrl || "https://api.openai.com/v1",
        apiKey: apiKey.trim() || prev?.apiKey || "",
        modelId: modelId.trim() || prev?.modelId || "gpt-4.1",
      };
      if (!next.apiKey) throw new Error("API key is required.");
      writeLlmConfig(next, home);
      cfg = next;
      modelRuntime = await ModelRuntime.create({
        authPath: authPath(home),
        modelsPath: modelsPath(home),
      });
      warning = undefined;
      await rebuildSession();
    },
    async dispose() {
      unsubscribe?.();
      session?.dispose();
    },
  };
}
