#!/usr/bin/env bun
import { createPiController } from "./pi-session.js";
import {
  createNativeDecoder,
  encodeNativeMessage,
  type ClientMessage,
  type HostMessage,
} from "./protocol.js";
import type { BrowserBridge } from "./browser-tools.js";

function send(msg: HostMessage) {
  process.stdout.write(encodeNativeMessage(msg));
}

const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
let reqCounter = 0;

const bridge: BrowserBridge = {
  call(method, params) {
    const id = `b${++reqCounter}`;
    send({ type: "browser_request", id, method, params });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Browser tool timed out: ${method}`));
      }, 60_000);
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

const decoder = createNativeDecoder();
let controller: Awaited<ReturnType<typeof createPiController>> | null = null;
let starting: Promise<void> | null = null;

async function ensureController() {
  if (controller) return controller;
  if (!starting) {
    starting = createPiController(bridge)
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

async function handle(msg: ClientMessage) {
  if (msg.type === "hello") {
    try {
      const c = await ensureController();
      send({
        type: "hello_ok",
        models: c.models,
        model: c.model,
        stagehand: c.stagehand,
        piReady: Boolean(c.model),
        warning: c.warning,
      });
    } catch (err) {
      send({
        type: "hello_error",
        message: err instanceof Error ? err.message : String(err),
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

  const c = await ensureController();

  if (msg.type === "abort") {
    await c.abort();
    return;
  }
  if (msg.type === "new_session") {
    await c.newSession();
    return;
  }
  if (msg.type === "set_model") {
    await c.setModel(msg.provider, msg.modelId);
    return;
  }
  if (msg.type === "prompt") {
    await c.prompt(msg.id, msg.text, msg.tab, (event) => {
      send({ type: "event", id: msg.id, event });
    });
  }
}

process.stdin.on("data", (chunk) => {
  try {
    for (const msg of decoder.push(Buffer.from(chunk))) {
      void handle(msg as ClientMessage).catch((err) => {
        send({
          type: "event",
          id: "host",
          event: { type: "error", message: err instanceof Error ? err.message : String(err) },
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
