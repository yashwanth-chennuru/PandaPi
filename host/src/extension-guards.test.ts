import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const ext = path.join(import.meta.dir, "../../extension");

test("browser inject uses ISOLATED world and self-contained runPageAction", () => {
  const browser = readFileSync(path.join(ext, "browser.js"), "utf8");
  expect(browser).toContain('world: "ISOLATED"');
  expect(browser).toContain("runPageAction");
  expect(browser).toContain("withFocusRestored");
  expect(browser).not.toContain('world: "MAIN"');
});

test("page-actions exports a single self-contained entrypoint", () => {
  const src = readFileSync(path.join(ext, "page-actions.js"), "utf8");
  expect(src).toContain("export function runPageAction");
  expect(src).toContain("function findRef");
  // Old bug: module-scoped findRef used from clickRef/typeRef
  expect(src).not.toMatch(/export function clickRef/);
  expect(src).not.toMatch(/export function typeRef/);
});

test("background routes events by panel ownership instead of blanket broadcast", () => {
  const src = readFileSync(path.join(ext, "background.js"), "utf8");
  expect(src).toContain("promptOwner");
  expect(src).toContain("panelsById");
  expect(src).toContain("sendToPanel");
  expect(src).toContain("routeHostMessage");
});

test("sidepanel uses progress-aware idle timeout and filters by prompt id", () => {
  const src = readFileSync(path.join(ext, "sidepanel.js"), "utf8");
  expect(src).toContain("PROGRESS_IDLE_MS");
  expect(src).toContain("bumpProgressWatch");
  expect(src).toContain("activePromptId");
  expect(src).not.toMatch(/setTimeout\(\(\) => \{[^}]*reconnect_host[^}]*\}, 20_000\)/);
});

test("setup-host creates a Windows launcher path and fails closed on zero writes", () => {
  const src = readFileSync(path.join(import.meta.dir, "../../scripts/setup-host.mjs"), "utf8");
  expect(src).toContain("pandapi-host.cmd");
  expect(src).toContain("win32");
  expect(src).toContain("NativeMessagingHosts");
  expect(src).toContain("process.exit(1)");
  expect(src).toContain("zero browser paths");
});

test("page-actions keeps refs out of the DOM", () => {
  const src = readFileSync(path.join(ext, "page-actions.js"), "utf8");
  expect(src).toContain("__pandapiRefsV1");
  // Refs must not be page-readable/forgeable DOM attributes.
  expect(src).not.toContain("data-pandapi-ref");
  expect(src).not.toContain("setAttribute");
});

test("browser.js validates navigation schemes and captures JPEG", () => {
  const src = readFileSync(path.join(ext, "browser.js"), "utf8");
  expect(src).toContain("assertNavigable");
  expect(src).toContain('format: "jpeg"');
  expect(src).not.toContain("chrome://newtab");
});

test("host serializes control messages and clears stale approvals", () => {
  const src = readFileSync(path.join(import.meta.dir, "../src/index.ts"), "utf8");
  expect(src).toContain("approval_resolved");
  expect(src).toMatch(/msg\.type === "new_session"[\s\S]*?enqueuePrompt/);
  expect(src).toMatch(/msg\.type === "set_model"[\s\S]*?enqueuePrompt/);
  expect(src).toMatch(/msg\.type === "set_config"[\s\S]*?enqueuePrompt/);
});
