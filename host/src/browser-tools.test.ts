import { expect, test } from "bun:test";
import { createBrowserTools } from "./browser-tools.ts";
import type { TabContext } from "./protocol.ts";

const tab: TabContext = { tabId: 1, windowId: 1, title: "T", url: "https://example.com" };

function toolsWithResult(result: unknown, supportsImages: boolean) {
  const bridge = { call: async () => result };
  return createBrowserTools({
    getTab: () => tab,
    bridge,
    getStagehand: () => null,
    supportsImages: () => supportsImages,
  });
}

function byName(tools: ReturnType<typeof createBrowserTools>, name: string) {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`missing tool ${name}`);
  return tool;
}

test("screenshot returns an image block when the model supports vision", async () => {
  const tools = toolsWithResult(
    { mimeType: "image/jpeg", dataUrl: "data:image/jpeg;base64,QUJD" },
    true,
  );
  const res = await byName(tools, "screenshot").execute("t", {}, undefined, undefined, {} as never);
  expect(res.content).toHaveLength(2);
  expect(res.content[0].type).toBe("text");
  expect(res.content[1]).toEqual({ type: "image", data: "QUJD", mimeType: "image/jpeg" });
});

test("screenshot stays text-only when the model cannot see images", async () => {
  const tools = toolsWithResult(
    { mimeType: "image/jpeg", dataUrl: "data:image/jpeg;base64,QUJD" },
    false,
  );
  const res = await byName(tools, "screenshot").execute("t", {}, undefined, undefined, {} as never);
  expect(res.content).toHaveLength(1);
  expect(res.content[0].type).toBe("text");
});

test("page_text is routed through the browser bridge", async () => {
  let called: { method: string; params: Record<string, unknown> } | undefined;
  const bridge = {
    call: async (method: string, params: Record<string, unknown>) => {
      called = { method, params };
      return { title: "T", text: "hello" };
    },
  };
  const tools = createBrowserTools({
    getTab: () => tab,
    bridge,
    getStagehand: () => null,
    supportsImages: () => false,
  });
  const res = await byName(tools, "page_text").execute("t", {}, undefined, undefined, {} as never);
  expect(called?.method).toBe("page_text");
  expect(called?.params.tabId).toBe(1);
  expect(res.content[0].type).toBe("text");
});
