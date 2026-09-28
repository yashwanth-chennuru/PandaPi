import { expect, test } from "bun:test";
import { createNativeDecoder, encodeNativeMessage, gmailComposeUrl, parseDataUrl, pickInitialModel, resolvePandapiHome } from "./protocol.ts";

test("native message roundtrip", () => {
  const decoder = createNativeDecoder();
  const payload = { type: "hello", n: 1 };
  const frames = decoder.push(encodeNativeMessage(payload));
  expect(frames).toEqual([payload]);
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

test("parseDataUrl splits mime and base64", () => {
  expect(parseDataUrl("data:image/jpeg;base64,AAAA")).toEqual({
    mimeType: "image/jpeg",
    base64: "AAAA",
  });
  expect(parseDataUrl("not-a-data-url")).toBeNull();
});

test("pickInitialModel prefers the configured default", () => {
  const available = [
    { provider: "opencode-go", id: "minimax-m3" },
    { provider: "opencode-go", id: "kimi-k2.6" },
  ];
  expect(pickInitialModel(available, { provider: "opencode-go", id: "kimi-k2.6" })?.id).toBe("kimi-k2.6");
  expect(pickInitialModel(available, { provider: "opencode-go", id: "missing" })?.id).toBe("minimax-m3");
  expect(pickInitialModel(available, undefined)?.id).toBe("minimax-m3");
  expect(pickInitialModel([], { provider: "x", id: "y" })).toBeUndefined();
});

test("resolvePandapiHome defaults to ~/.pandapi and honors PANDAPI_HOME", () => {
  expect(resolvePandapiHome({})).toContain(".pandapi");
  expect(resolvePandapiHome({ PANDAPI_HOME: "  /tmp/custom  " })).toBe("/tmp/custom");
  expect(resolvePandapiHome({ PANDAPI_HOME: "" })).toContain(".pandapi");
});
