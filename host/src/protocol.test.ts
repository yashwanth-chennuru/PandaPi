import assert from "node:assert/strict";
import test from "node:test";
import { createNativeDecoder, encodeNativeMessage, gmailComposeUrl } from "./protocol.js";

test("native message roundtrip", () => {
  const decoder = createNativeDecoder();
  const payload = { type: "hello", n: 1 };
  const frames = decoder.push(encodeNativeMessage(payload));
  assert.deepEqual(frames, [payload]);
});

test("native decoder handles split chunks", () => {
  const decoder = createNativeDecoder();
  const buf = encodeNativeMessage({ a: "x".repeat(50) });
  assert.deepEqual(decoder.push(buf.subarray(0, 3)), []);
  const rest = decoder.push(buf.subarray(3));
  assert.equal(rest.length, 1);
  assert.equal((rest[0] as { a: string }).a.length, 50);
});

test("gmail compose url encodes to/subject/body", () => {
  const url = gmailComposeUrl({
    to: "dad@gmail.com",
    subject: "Ticket",
    body: "See screenshot",
  });
  assert.match(url, /^https:\/\/mail\.google\.com\/mail\/\?/);
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get("view"), "cm");
  assert.equal(parsed.searchParams.get("to"), "dad@gmail.com");
  assert.equal(parsed.searchParams.get("su"), "Ticket");
  assert.equal(parsed.searchParams.get("body"), "See screenshot");
});
