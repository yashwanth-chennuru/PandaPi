import { expect, test } from "bun:test";
import { createNativeDecoder, encodeNativeMessage, gmailComposeUrl } from "./protocol.ts";
import { isDangerousLabel, needsApproval } from "./danger.ts";
import { pandapiHome, writeLlmConfig, readLlmConfig, publicConfig, PROVIDER_ID } from "./config.ts";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

test("native message roundtrip", () => {
  const decoder = createNativeDecoder();
  const payload = { type: "hello", n: 1 };
  expect(decoder.push(encodeNativeMessage(payload))).toEqual([payload]);
});

test("native decoder handles split chunks", () => {
  const decoder = createNativeDecoder();
  const buf = encodeNativeMessage({ a: "x".repeat(50) });
  expect(decoder.push(buf.subarray(0, 3))).toEqual([]);
  const rest = decoder.push(buf.subarray(3));
  expect(rest.length).toBe(1);
  expect((rest[0] as { a: string }).a.length).toBe(50);
});

test("gmail compose url encodes to/subject/body", () => {
  const url = gmailComposeUrl({
    to: "dad@gmail.com",
    subject: "Ticket",
    body: "See screenshot",
  });
  expect(url.startsWith("https://mail.google.com/mail/?")).toBe(true);
  const parsed = new URL(url);
  expect(parsed.searchParams.get("view")).toBe("cm");
  expect(parsed.searchParams.get("to")).toBe("dad@gmail.com");
  expect(parsed.searchParams.get("su")).toBe("Ticket");
  expect(parsed.searchParams.get("body")).toBe("See screenshot");
});

test("dangerous labels", () => {
  expect(isDangerousLabel("Send")).toBe(true);
  expect(isDangerousLabel("Place order")).toBe(true);
  expect(isDangerousLabel("Delete account")).toBe(true);
  expect(isDangerousLabel("Learn more")).toBe(false);
  expect(needsApproval("click", "Pay now")).toBe(true);
  expect(needsApproval("compose_gmail", "Send")).toBe(false);
});

test("isolated config writes under PANDAPI_HOME not ~/.pi", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "pandapi-"));
  try {
    writeLlmConfig(
      {
        providerId: PROVIDER_ID,
        baseUrl: "https://example.test/v1/",
        apiKey: "sk-test-key-123456",
        modelId: "gpt-test",
      },
      dir,
    );
    const cfg = readLlmConfig(dir);
    expect(cfg?.baseUrl).toBe("https://example.test/v1");
    expect(cfg?.modelId).toBe("gpt-test");
    expect(cfg?.apiKey).toBe("sk-test-key-123456");
    const raw = JSON.parse(readFileSync(path.join(dir, "models.json"), "utf8")) as {
      providers: { compat: { compat: { maxTokensField: string } } };
    };
    expect(raw.providers.compat.compat.maxTokensField).toBe("max_tokens");
    const pub = publicConfig(cfg);
    expect(pub.hasKey).toBe(true);
    expect(pub.keyHint.includes("sk-t")).toBe(true);
    expect(dir.includes(".pi/agent")).toBe(false);
    expect(pandapiHome()).not.toBe(path.join(os.homedir(), ".pi", "agent"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
