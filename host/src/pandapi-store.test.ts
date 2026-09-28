import { expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readJsonObject, storePandapiKey } from "./pandapi-store.ts";

function tempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pandapi-store-"));
}

test("storePandapiKey writes 0600 auth and merges providers", () => {
  const home = tempHome();
  try {
    storePandapiKey(home, "opencode-go", "key-one");
    storePandapiKey(home, "openai", "key-two", "gpt-x");

    const auth = readJsonObject(path.join(home, "auth.json"));
    expect(auth["opencode-go"]).toEqual({ type: "api_key", key: "key-one" });
    expect(auth.openai).toEqual({ type: "api_key", key: "key-two" });

    const mode = fs.statSync(path.join(home, "auth.json")).mode & 0o777;
    expect(mode).toBe(0o600);

    const settings = readJsonObject(path.join(home, "settings.json"));
    expect(settings.defaultProvider).toBe("openai");
    expect(settings.defaultModel).toBe("gpt-x");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("storePandapiKey leaves settings alone when no model is given", () => {
  const home = tempHome();
  try {
    storePandapiKey(home, "opencode-go", "k");
    expect(fs.existsSync(path.join(home, "settings.json"))).toBe(false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
