import { expect, test } from "bun:test";
import { spawn } from "bun";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createNativeDecoder, encodeNativeMessage } from "./protocol.ts";

test("native host hello_ok without sharing ~/.pi", async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "pandapi-home-"));
  const proc = spawn(["bun", path.join(import.meta.dir, "index.ts")], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, PANDAPI_HOME: home, HOME: home },
  });
  try {
    proc.stdin.write(encodeNativeMessage({ type: "hello" }));
    const decoder = createNativeDecoder();
    let msg: { type?: string; llm?: { hasKey?: boolean }; warning?: string } | undefined;
    const timeout = AbortSignal.timeout(12_000);
    for await (const chunk of proc.stdout) {
      if (timeout.aborted) break;
      for (const frame of decoder.push(Buffer.from(chunk))) {
        const typed = frame as { type?: string };
        if (typed.type === "hello_ok" || typed.type === "hello_error") {
          msg = frame as typeof msg;
          break;
        }
      }
      if (msg) break;
    }
    expect(msg?.type).toBe("hello_ok");
    expect(msg?.llm?.hasKey).toBe(false);
    expect(msg?.warning || "").toContain("~/.pandapi");
  } finally {
    proc.kill();
    rmSync(home, { recursive: true, force: true });
  }
}, 20_000);
