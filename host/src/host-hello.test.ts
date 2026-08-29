import { expect, test } from "bun:test";
import { spawn } from "bun";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createNativeDecoder, encodeNativeMessage } from "./protocol.ts";

type Hello = {
  type: string;
  llm?: { hasKey?: boolean; baseUrl?: string; modelId?: string };
  warning?: string;
};

function helloReader(proc: ReturnType<typeof spawn>) {
  const decoder = createNativeDecoder();
  const pending: Hello[] = [];
  let notify: (() => void) | undefined;
  void (async () => {
    for await (const chunk of proc.stdout) {
      for (const frame of decoder.push(Buffer.from(chunk))) {
        const typed = frame as { type?: string };
        if (typed.type === "hello_ok" || typed.type === "hello_error") {
          pending.push(frame as Hello);
          notify?.();
        }
      }
    }
  })();
  return {
    async next(ms = 12_000): Promise<Hello> {
      const deadline = Date.now() + ms;
      while (Date.now() < deadline) {
        const msg = pending.shift();
        if (msg) return msg;
        await new Promise<void>((resolve) => {
          notify = resolve;
          setTimeout(resolve, 40);
        });
      }
      throw new Error("timed out waiting for hello");
    },
  };
}

test("native host hello_ok without sharing ~/.pi", async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "pandapi-home-"));
  const proc = spawn(["bun", path.join(import.meta.dir, "index.ts")], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, PANDAPI_HOME: home, HOME: home, PI_OFFLINE: "1" },
  });
  try {
    const hellos = helloReader(proc);
    proc.stdin.write(encodeNativeMessage({ type: "hello" }));
    const msg = await hellos.next();
    expect(msg.type).toBe("hello_ok");
    expect(msg.llm?.hasKey).toBe(false);
    expect(msg.warning || "").toContain("~/.pandapi");
  } finally {
    proc.kill();
    rmSync(home, { recursive: true, force: true });
  }
}, 20_000);

test("second hello still has the saved key and base URL", async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "pandapi-home-"));
  const proc = spawn(["bun", path.join(import.meta.dir, "index.ts")], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, PANDAPI_HOME: home, HOME: home, PI_OFFLINE: "1" },
  });
  try {
    const hellos = helloReader(proc);
    proc.stdin.write(encodeNativeMessage({ type: "hello" }));
    await hellos.next();
    proc.stdin.write(
      encodeNativeMessage({
        type: "set_config",
        baseUrl: "https://example.test/v1",
        apiKey: "sk-keep-me-123456",
        modelId: "gpt-test",
      }),
    );
    const afterSave = await hellos.next();
    expect(afterSave.llm?.hasKey).toBe(true);
    expect(afterSave.llm?.baseUrl).toBe("https://example.test/v1");
    proc.stdin.write(encodeNativeMessage({ type: "hello" }));
    const again = await hellos.next();
    expect(again.type).toBe("hello_ok");
    expect(again.llm?.hasKey).toBe(true);
    expect(again.llm?.baseUrl).toBe("https://example.test/v1");
    expect(again.llm?.modelId).toBe("gpt-test");
  } finally {
    proc.kill();
    rmSync(home, { recursive: true, force: true });
  }
}, 20_000);
