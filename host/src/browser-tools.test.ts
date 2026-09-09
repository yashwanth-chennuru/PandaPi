import { expect, test } from "bun:test";
import { createBrowserTools, type SnapshotBinding } from "./browser-tools.ts";
import type { TabContext } from "./protocol.ts";

const tab: TabContext = {
  tabId: 1,
  windowId: 1,
  title: "Test",
  url: "https://example.test/checkout",
};

function bind(items: SnapshotBinding["items"], tabId = 1, url = tab.url): SnapshotBinding {
  return { tabId, url, generation: "g1", items };
}

test("click on Pay now is denied when the user rejects approval", async () => {
  let snap: SnapshotBinding | null = bind([{ ref: "e1", name: "Pay now", role: "button" }]);
  const calls: string[] = [];
  const tools = createBrowserTools({
    getTab: () => tab,
    bridge: {
      async call(method) {
        calls.push(method);
        if (method === "describe") {
          return { ok: true, name: "Pay now", tag: "button", url: tab.url };
        }
        if (method === "click") return { ok: true };
        if (method === "snapshot") return { ...snap, items: snap?.items ?? [], text: "snap" };
        return {};
      },
    },
    requestApproval: async () => false,
    getSnapshot: () => snap,
    setSnapshot: (next) => {
      snap = next;
    },
  });
  const click = tools.find((t) => t.name === "click");
  if (!click) throw new Error("missing click");
  const result = await click.execute("t1", { ref: "e1" }, undefined, undefined, {} as never);
  const text = result.content.map((c) => ("text" in c ? c.text : "")).join("");
  expect(text).toContain("denied");
  expect(calls.includes("click")).toBe(false);
  expect(calls.includes("describe")).toBe(true);
});

test("click on a safe ref does not ask for approval", async () => {
  let snap: SnapshotBinding | null = bind([{ ref: "e2", name: "Learn more", role: "link" }]);
  let asked = false;
  const tools = createBrowserTools({
    getTab: () => tab,
    bridge: {
      async call(method) {
        if (method === "describe") {
          return { ok: true, name: "Learn more", tag: "a", href: "/more", url: tab.url };
        }
        if (method === "click") return { ok: true, ref: "e2" };
        if (method === "snapshot") return { ...snap, items: snap?.items ?? [], text: "snap" };
        return {};
      },
    },
    requestApproval: async () => {
      asked = true;
      return true;
    },
    getSnapshot: () => snap,
    setSnapshot: (next) => {
      snap = next;
    },
  });
  const click = tools.find((t) => t.name === "click");
  if (!click) throw new Error("missing click");
  const result = await click.execute("t1", { ref: "e2" }, undefined, undefined, {} as never);
  expect(asked).toBe(false);
  const text = result.content.map((c) => ("text" in c ? c.text : "")).join("");
  expect(text).toContain("e2");
});

test("type_text with pressEnter always requires approval", async () => {
  let snap: SnapshotBinding | null = bind([{ ref: "e3", name: "Search", role: "textbox" }]);
  let asked = false;
  const tools = createBrowserTools({
    getTab: () => tab,
    bridge: {
      async call(method) {
        if (method === "describe") return { ok: true, name: "Search", tag: "input", url: tab.url };
        if (method === "type_text") return { ok: true };
        if (method === "snapshot") return { ...snap, items: snap?.items ?? [] };
        return {};
      },
    },
    requestApproval: async () => {
      asked = true;
      return false;
    },
    getSnapshot: () => snap,
    setSnapshot: (next) => {
      snap = next;
    },
  });
  const typeText = tools.find((t) => t.name === "type_text");
  if (!typeText) throw new Error("missing type_text");
  const result = await typeText.execute(
    "t1",
    { ref: "e3", text: "hi", pressEnter: true },
    undefined,
    undefined,
    {} as never,
  );
  expect(asked).toBe(true);
  const text = result.content.map((c) => ("text" in c ? c.text : "")).join("");
  expect(text).toContain("denied");
});

test("press_key Enter requires approval", async () => {
  let asked = false;
  const tools = createBrowserTools({
    getTab: () => tab,
    bridge: {
      async call() {
        return { ok: true };
      },
    },
    requestApproval: async () => {
      asked = true;
      return false;
    },
    getSnapshot: () => null,
    setSnapshot: () => {},
  });
  const press = tools.find((t) => t.name === "press_key");
  if (!press) throw new Error("missing press_key");
  const result = await press.execute("t1", { key: "Enter" }, undefined, undefined, {} as never);
  expect(asked).toBe(true);
  const text = result.content.map((c) => ("text" in c ? c.text : "")).join("");
  expect(text).toContain("denied");
});

test("ref from another tab is rejected", async () => {
  let snap: SnapshotBinding | null = bind([{ ref: "e4", name: "Harmless", role: "button" }], 99, "https://other.test/");
  const tools = createBrowserTools({
    getTab: () => tab,
    bridge: {
      async call() {
        return { ok: true };
      },
    },
    requestApproval: async () => true,
    getSnapshot: () => snap,
    setSnapshot: (next) => {
      snap = next;
    },
  });
  const click = tools.find((t) => t.name === "click");
  if (!click) throw new Error("missing click");
  await expect(click.execute("t1", { ref: "e4" }, undefined, undefined, {} as never)).rejects.toThrow(
    /not bound to tab 1/,
  );
});

test("screenshot returns image content for the model", async () => {
  const tools = createBrowserTools({
    getTab: () => tab,
    bridge: {
      async call(method) {
        if (method === "screenshot") {
          return {
            note: "ok",
            dataUrl: "data:image/png;base64,aaa",
            mimeType: "image/png",
          };
        }
        return {};
      },
    },
    requestApproval: async () => true,
    getSnapshot: () => null,
    setSnapshot: () => {},
  });
  const shot = tools.find((t) => t.name === "screenshot");
  if (!shot) throw new Error("missing screenshot");
  const result = await shot.execute("t1", {}, undefined, undefined, {} as never);
  expect(result.content.some((c) => c.type === "image")).toBe(true);
  const img = result.content.find((c) => c.type === "image") as { data: string; mimeType: string };
  expect(img.data).toBe("aaa");
  expect(img.mimeType).toBe("image/png");
});

test("navigate clears snapshot binding", async () => {
  let snap: SnapshotBinding | null = bind([{ ref: "e1", name: "x", role: "button" }]);
  const tools = createBrowserTools({
    getTab: () => tab,
    bridge: {
      async call() {
        return { ok: true };
      },
    },
    requestApproval: async () => true,
    getSnapshot: () => snap,
    setSnapshot: (next) => {
      snap = next;
    },
  });
  const navigate = tools.find((t) => t.name === "navigate");
  if (!navigate) throw new Error("missing navigate");
  await navigate.execute("t1", { url: "https://example.test/next" }, undefined, undefined, {} as never);
  expect(snap).toBeNull();
});
