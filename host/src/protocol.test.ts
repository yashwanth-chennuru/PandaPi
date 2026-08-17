import { expect, test } from "bun:test";
import { createNativeDecoder, encodeNativeMessage, gmailComposeUrl } from "./protocol.ts";

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
