#!/usr/bin/env bun
import "./stdio-guard.js";
import { createPiController } from "./pi-session.js";
import {
  createNativeDecoder,
  encodeNativeMessage,
  type ClientMessage,
  type HostMessage,
} from "./protocol.js";
import type { ApprovalFn, BrowserBridge } from "./browser-tools.js";

function send(msg: HostMessage) {
  process.stdout.write(encodeNativeMessage(msg));
}

const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
const approvals = new Map<string, { resolve: (v: boolean) => void }>();
let reqCounter = 0;
let approvalCounter = 0;

/** Panel that owns the currently running / queued prompt context. */
let activePanelId: string | undefined;

const bridge: BrowserBridge = {
  call(method, params) {
    const id = `b${++reqCounter}`;
    send({ type: "browser_request", id, method, params, panelId: activePanelId });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Browser tool timed out: ${method}`));
      }, 90_000);
      pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
    });
  },
};

const requestApproval: ApprovalFn = (summary) => {
  const id = `a${++approvalCounter}`;
  const panelId = activePanelId;
  send({ type: "approval_request", id, summary, panelId });
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      approvals.delete(id);
      // Tell the owning panel so a stale Approve/Deny card is cleared.
      send({ type: "approval_resolved", id, allow: false, panelId });
      resolve(false);
    }, 120_000);
    approvals.set(id, {
      resolve: (allow) => {
        clearTimeout(timer);
        resolve(allow);
      },
    });
  });
};

const decoder = createNativeDecoder();
let controller: Awaited<ReturnType<typeof createPiController>> | null = null;
let starting: Promise<void> | null = null;

/** Serialize prompts so emitCurrent / activePanelId cannot be overwritten mid-run. */
let promptChain: Promise<void> = Promise.resolve();

async function ensureController() {
  if (controller) return controller;
  if (!starting) {
    starting = createPiController({ bridge, requestApproval })
      .then((c) => {
        controller = c;
      })
      .catch((err) => {
        starting = null;
        throw err;
      });
  }
  await starting;
  return controller!;
}

function helloPayload(
  c: Awaited<ReturnType<typeof createPiController>>,
  panelId?: string,
): HostMessage {
  return {
    type: "hello_ok",
    models: c.models,
    model: c.model,
    piReady: Boolean(c.model),
    llm: c.llm,
    warning: c.warning,
    panelId,
  };
}

function enqueuePrompt(run: () => Promise<void>): Promise<void> {
  const next = promptChain.then(run, run);
  promptChain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

async function handle(msg: ClientMessage) {
  if (msg.type === "hello") {
    try {
      const c = await ensureController();
      send(helloPayload(c, msg.panelId));
    } catch (err) {
      send({
        type: "hello_error",
        message: err instanceof Error ? err.message : String(err),
        panelId: msg.panelId,
      });
    }
    return;
  }

  if (msg.type === "browser_result") {
    const waiter = pending.get(msg.id);
    if (!waiter) return;
    pending.delete(msg.id);
    if (msg.ok) waiter.resolve(msg.result);
    else waiter.reject(new Error(msg.error ?? "Browser request failed"));
    return;
  }

  if (msg.type === "approval_result") {
    const waiter = approvals.get(msg.id);
    if (!waiter) return;
    approvals.delete(msg.id);
    waiter.resolve(msg.allow);
    return;
  }

  const c = await ensureController();

  if (msg.type === "abort") {
    await c.abort();
    return;
  }
  if (msg.type === "new_session") {
    await enqueuePrompt(async () => {
      await c.newSession();
    });
    return;
  }
  if (msg.type === "set_model") {
    await enqueuePrompt(async () => {
      await c.setModel(msg.provider, msg.modelId);
    });
    return;
  }
  if (msg.type === "set_config") {
    try {
      // Control messages rebuild the session, so they must not run while a
      // prompt is in flight. The prompt chain serializes them behind it.
      await enqueuePrompt(async () => {
        await c.setConfig(msg.baseUrl, msg.apiKey, msg.modelId);
      });
      send(helloPayload(c, msg.panelId));
    } catch (err) {
      send({
        type: "hello_error",
        message: err instanceof Error ? err.message : String(err),
        panelId: msg.panelId,
      });
    }
    return;
  }
  if (msg.type === "prompt") {
    const panelId = msg.panelId;
    const promptId = msg.id;
    await enqueuePrompt(async () => {
      activePanelId = panelId;
      try {
        await c.prompt(promptId, msg.text, msg.tab, (event) => {
          send({ type: "event", id: promptId, event, panelId });
        });
      } finally {
        if (activePanelId === panelId) activePanelId = undefined;
      }
    });
  }
}

process.stdin.on("data", (chunk) => {
  try {
    for (const msg of decoder.push(Buffer.from(chunk))) {
      void handle(msg as ClientMessage).catch((err) => {
        // Tag the error with the requesting panel when the message carries one;
        // otherwise the background cannot route it and the failure is silent.
        const panelId = (msg as { panelId?: string }).panelId ?? activePanelId;
        send({
          type: "event",
          id: "host",
          event: { type: "error", message: err instanceof Error ? err.message : String(err) },
          panelId,
        });
      });
    }
  } catch (err) {
    send({
      type: "hello_error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

process.stdin.on("end", async () => {
  await controller?.dispose();
  process.exit(0);
});

process.stdin.resume();
