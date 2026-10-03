import { expect, test } from "bun:test";
import { createNativeDecoder, encodeNativeMessage, gmailComposeUrl, assertNavigableUrl } from "./protocol.ts";
import { isDangerousLabel, needsApproval } from "./danger.ts";
import {
  pandapiHome,
  writeLlmConfig,
  readLlmConfig,
  publicConfig,
  resolveCacheRetention,
  resolvePromptCache,
  PROVIDER_ID,
  ensureHome,
} from "./config.ts";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runPageAction } from "../../extension/page-actions.js";

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

test("dangerous labels cover confirm/continue euphemisms", () => {
  expect(isDangerousLabel("Send")).toBe(true);
  expect(isDangerousLabel("Place order")).toBe(true);
  expect(isDangerousLabel("Delete account")).toBe(true);
  expect(isDangerousLabel("Confirm")).toBe(true);
  expect(isDangerousLabel("Continue")).toBe(true);
  expect(isDangerousLabel("Learn more")).toBe(false);
  expect(needsApproval("click", "Pay now")).toBe(true);
  expect(needsApproval("compose_gmail", "Send")).toBe(false);
  expect(needsApproval("type_text", "Search", { pressEnter: true })).toBe(true);
  expect(needsApproval("type_text", "Search", { pressEnter: false })).toBe(false);
  expect(needsApproval("press_key", undefined, { key: "Enter" })).toBe(true);
  expect(needsApproval("press_key", undefined, { key: "Escape" })).toBe(false);
});

test("dangerous vocabulary covers publishing and wallet actions", () => {
  for (const label of [
    "Post",
    "Publish",
    "Tweet",
    "Reply",
    "Comment",
    "Share",
    "Save changes",
    "Withdraw",
    "Deposit",
    "Swap",
    "Connect wallet",
    "Sign transaction",
    "Mint",
    "Stake",
  ]) {
    expect(isDangerousLabel(label)).toBe(true);
  }
  // Signing *in* is not dangerous; signing a transaction is.
  expect(isDangerousLabel("Sign in")).toBe(false);
  expect(isDangerousLabel("Learn more")).toBe(false);
});

test("submit-type and dangerous-href controls are gated without a label", () => {
  expect(needsApproval("click", undefined, { type: "submit" })).toBe(true);
  expect(needsApproval("click", "e12", { type: "submit" })).toBe(true);
  expect(needsApproval("click", "e12", { href: "mailto:x@y.test" })).toBe(true);
  expect(needsApproval("click", "e12", { href: "/checkout/step-2" })).toBe(true);
  expect(needsApproval("click", "e12", { href: "/docs/intro" })).toBe(false);
  expect(needsApproval("click", "Read more", { type: "button" })).toBe(false);
  expect(needsApproval("click", undefined, {})).toBe(false);
});

test("assertNavigableUrl allows http(s) and about:blank only", () => {
  expect(assertNavigableUrl("https://example.test/a?b=1")).toBe("https://example.test/a?b=1");
  expect(assertNavigableUrl("http://example.test/")).toBe("http://example.test/");
  expect(assertNavigableUrl("about:blank")).toBe("about:blank");
  expect(() => assertNavigableUrl("javascript:alert(1)")).toThrow(/javascript:/);
  expect(() => assertNavigableUrl("data:text/html,<h1>x</h1>")).toThrow(/data:/);
  expect(() => assertNavigableUrl("file:///etc/passwd")).toThrow(/file:/);
  expect(() => assertNavigableUrl("chrome://settings")).toThrow(/chrome:/);
  expect(() => assertNavigableUrl("/relative/path")).toThrow(/absolute/);
  expect(() => assertNavigableUrl("   ")).toThrow(/empty/);
});

test("resolveCacheRetention is opt-in and defaults to Pi's short cache", () => {
  expect(resolveCacheRetention({})).toBeUndefined();
  expect(resolveCacheRetention({ PANDAPI_CACHE_RETENTION: "long" })).toBe("long");
  expect(resolveCacheRetention({ PANDAPI_CACHE_RETENTION: "SHORT" })).toBe("short");
  expect(resolveCacheRetention({ PI_CACHE_RETENTION: "long" })).toBe("long");
  expect(resolveCacheRetention({ PANDAPI_CACHE_RETENTION: "nonsense" })).toBeUndefined();
});

test("resolvePromptCache parses tier:seconds and rejects junk", () => {
  expect(resolvePromptCache({})).toBeUndefined();
  expect(resolvePromptCache({ PANDAPI_CACHE_LIFETIME: "300" })).toEqual({ short: 300 });
  expect(resolvePromptCache({ PANDAPI_CACHE_LIFETIME: "short:300" })).toEqual({ short: 300 });
  expect(resolvePromptCache({ PANDAPI_CACHE_LIFETIME: "long:3600" })).toEqual({ long: 3600 });
  expect(resolvePromptCache({ PANDAPI_CACHE_LIFETIME: "forever:10" })).toBeUndefined();
  expect(resolvePromptCache({ PANDAPI_CACHE_LIFETIME: "short:abc" })).toBeUndefined();
  expect(resolvePromptCache({ PANDAPI_CACHE_LIFETIME: "short:-5" })).toBeUndefined();
});

test("writeLlmConfig only declares promptCache when opted in", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "pandapi-cache-"));
  const previous = process.env.PANDAPI_CACHE_LIFETIME;
  try {
    const cfg = {
      providerId: PROVIDER_ID,
      baseUrl: "https://example.test/v1",
      apiKey: "sk-test-key-123456",
      modelId: "m",
    };
    delete process.env.PANDAPI_CACHE_LIFETIME;
    writeLlmConfig(cfg, dir);
    type ModelsJson = { providers: { compat: { models: Array<{ promptCache?: unknown }> } } };
    let raw = JSON.parse(readFileSync(path.join(dir, "models.json"), "utf8")) as ModelsJson;
    expect(raw.providers.compat.models[0].promptCache).toBeUndefined();

    process.env.PANDAPI_CACHE_LIFETIME = "short:300";
    writeLlmConfig(cfg, dir);
    raw = JSON.parse(readFileSync(path.join(dir, "models.json"), "utf8")) as ModelsJson;
    expect(raw.providers.compat.models[0].promptCache).toEqual({ short: 300 });
  } finally {
    if (previous === undefined) delete process.env.PANDAPI_CACHE_LIFETIME;
    else process.env.PANDAPI_CACHE_LIFETIME = previous;
    rmSync(dir, { recursive: true, force: true });
  }
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
      providers: { compat: { compat: { maxTokensField: string }; models: Array<{ input: string[] }> } };
    };
    expect(raw.providers.compat.compat.maxTokensField).toBe("max_tokens");
    expect(raw.providers.compat.models[0].input).toContain("image");
    const pub = publicConfig(cfg);
    expect(pub.hasKey).toBe(true);
    expect(pub.keyHint.includes("sk-t")).toBe(true);
    expect(dir.includes(".pi/agent")).toBe(false);
    expect(pandapiHome()).not.toBe(path.join(os.homedir(), ".pi", "agent"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("config directory is 0700 and models.json is 0600", () => {
  if (process.platform === "win32") return;
  const dir = mkdtempSync(path.join(os.tmpdir(), "pandapi-perm-"));
  try {
    ensureHome(dir);
    writeLlmConfig(
      {
        providerId: PROVIDER_ID,
        baseUrl: "https://example.test/v1",
        apiKey: "sk-secret",
        modelId: "m",
      },
      dir,
    );
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(path.join(dir, "models.json")).mode & 0o777).toBe(0o600);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runPageAction is self-contained (Chrome executeScript serialization)", () => {
  const src = Function.prototype.toString.call(runPageAction);
  expect(src).toContain("function findRef");
  expect(src).toContain("function snapshot");
  expect(src).toContain("pageText");
  expect(src).toContain("function clearRefs");
  // Must not close over module-level helpers — only the function body is serialized.
  expect(src.startsWith("function") || src.includes("=>")).toBe(true);
});
