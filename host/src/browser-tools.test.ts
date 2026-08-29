import { expect, test } from "bun:test";
import { createBrowserTools } from "./browser-tools.ts";
import type { TabContext } from "./protocol.ts";

const tab: TabContext = {
  tabId: 1,
  windowId: 1,
  title: "Test",
  url: "https://example.test/checkout",
};

test("click on Pay now is denied when the user rejects approval", async () => {
  let items: Array<{ ref: string; name?: string; role?: string }> = [
    { ref: "e1", name: "Pay now", role: "button" },
  ];
  const calls: string[] = [];
  const tools = createBrowserTools({
    getTab: () => tab,
    bridge: {
      async call(method) {
        calls.push(method);
        if (method === "click") return { ok: true };
        if (method === "snapshot") return { items, text: "snap" };
        return {};
      },
    },
    requestApproval: async () => false,
    getSnapshotItems: () => items,
    setSnapshotItems: (next) => {
      items = next;
    },
  });
  const click = tools.find((t) => t.name === "click");
  if (!click) throw new Error("missing click");
  const result = await click.execute(
    "t1",
    { ref: "e1" },
    undefined,
    undefined,
    {} as never,
  );
  const text = result.content.map((c) => ("text" in c ? c.text : "")).join("");
  expect(text).toContain("denied");
  expect(calls.includes("click")).toBe(false);
});

test("click on a safe ref does not ask for approval", async () => {
  let items: Array<{ ref: string; name?: string; role?: string }> = [
    { ref: "e2", name: "Learn more", role: "link" },
  ];
  let asked = false;
  const tools = createBrowserTools({
    getTab: () => tab,
    bridge: {
      async call(method) {
        if (method === "click") return { ok: true, ref: "e2" };
        if (method === "snapshot") return { items, text: "snap" };
        return {};
      },
    },
    requestApproval: async () => {
      asked = true;
      return true;
    },
    getSnapshotItems: () => items,
    setSnapshotItems: (next) => {
      items = next;
    },
  });
  const click = tools.find((t) => t.name === "click");
  if (!click) throw new Error("missing click");
  const result = await click.execute("t1", { ref: "e2" }, undefined, undefined, {} as never);
  expect(asked).toBe(false);
  const text = result.content.map((c) => ("text" in c ? c.text : "")).join("");
  expect(text).toContain("e2");
});
