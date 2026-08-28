import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { needsApproval } from "./danger.js";
import { gmailComposeUrl } from "./protocol.js";
import type { TabContext } from "./protocol.js";

export type BrowserBridge = {
  call: (method: string, params: Record<string, unknown>) => Promise<unknown>;
};

export type ApprovalFn = (summary: string) => Promise<boolean>;

export const BROWSER_TOOL_NAMES = [
  "tabs_list",
  "tabs_create",
  "tabs_activate",
  "navigate",
  "screenshot",
  "snapshot",
  "click",
  "type_text",
  "press_key",
  "scroll",
  "wait",
  "compose_gmail",
] as const;

type SnapshotItem = { ref: string; name?: string; role?: string };

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }], details: {} };
}

function jsonResult(value: unknown) {
  return textResult(typeof value === "string" ? value : JSON.stringify(value, null, 2));
}

function withTab(tab: TabContext | null | undefined, tabId?: number): Record<string, unknown> {
  const id = tabId ?? tab?.tabId;
  if (id == null) throw new Error("No attached tab. Keep a page chip attached, or pass tabId.");
  return { tabId: id };
}

function itemLabel(item: SnapshotItem | undefined, fallback: string): string {
  return (item?.name || item?.role || fallback).trim();
}

export function createBrowserTools(opts: {
  getTab: () => TabContext | null;
  bridge: BrowserBridge;
  requestApproval: ApprovalFn;
  getSnapshotItems: () => SnapshotItem[];
  setSnapshotItems: (items: SnapshotItem[]) => void;
}) {
  const { getTab, bridge, requestApproval, getSnapshotItems, setSnapshotItems } = opts;

  const rememberSnapshot = (raw: unknown) => {
    if (raw && typeof raw === "object" && Array.isArray((raw as { items?: unknown }).items)) {
      setSnapshotItems((raw as { items: SnapshotItem[] }).items);
    }
    return raw;
  };

  const tabs_list = defineTool({
    name: "tabs_list",
    label: "List tabs",
    description: "List open tabs in the current browser window.",
    parameters: Type.Object({}),
    execute: async () => jsonResult(await bridge.call("tabs_list", {})),
  });

  const tabs_create = defineTool({
    name: "tabs_create",
    label: "New tab",
    description: "Open a new tab. Optionally navigate it to a URL.",
    parameters: Type.Object({
      url: Type.Optional(Type.String({ description: "URL to open." })),
      active: Type.Optional(Type.Boolean()),
    }),
    execute: async (_id, params) =>
      jsonResult(await bridge.call("tabs_create", { url: params.url, active: params.active })),
  });

  const tabs_activate = defineTool({
    name: "tabs_activate",
    label: "Switch tab",
    description: "Focus an existing tab by id from tabs_list.",
    parameters: Type.Object({
      tabId: Type.Number(),
    }),
    execute: async (_id, params) => jsonResult(await bridge.call("tabs_activate", { tabId: params.tabId })),
  });

  const navigate = defineTool({
    name: "navigate",
    label: "Navigate",
    description: "Navigate the attached tab to a URL and wait until load completes.",
    parameters: Type.Object({
      url: Type.String(),
      tabId: Type.Optional(Type.Number()),
    }),
    execute: async (_id, params) =>
      jsonResult(await bridge.call("navigate", { ...withTab(getTab(), params.tabId), url: params.url })),
  });

  const screenshot = defineTool({
    name: "screenshot",
    label: "Screenshot",
    description:
      "Capture the visible tab. The image is shown in the side panel. Prefer snapshot for structure; use this when the page is visual (charts, canvas, maps).",
    parameters: Type.Object({
      tabId: Type.Optional(Type.Number()),
    }),
    execute: async (_id, params) => {
      const result = (await bridge.call("screenshot", withTab(getTab(), params.tabId))) as {
        note?: string;
        width?: number;
        height?: number;
      };
      return textResult(
        result.note ??
          `Screenshot captured (${result.width ?? "?"}x${result.height ?? "?"}). Shown in the side panel. Not written to disk.`,
      );
    },
  });

  const snapshot = defineTool({
    name: "snapshot",
    label: "Page snapshot",
    description:
      "Accessibility-style snapshot of the attached page with refs (e1, e2, …) for interactive elements. Call this before click/type. Do not invent refs.",
    parameters: Type.Object({
      tabId: Type.Optional(Type.Number()),
    }),
    execute: async (_id, params) => jsonResult(rememberSnapshot(await bridge.call("snapshot", withTab(getTab(), params.tabId)))),
  });

  const click = defineTool({
    name: "click",
    label: "Click",
    description: "Click an element from the latest snapshot by ref (e.g. e12). Returns a fresh snapshot after the click.",
    parameters: Type.Object({
      ref: Type.String({ description: "Ref from snapshot, like e12" }),
      tabId: Type.Optional(Type.Number()),
    }),
    execute: async (_id, params) => {
      const item = getSnapshotItems().find((it) => it.ref === params.ref);
      const label = itemLabel(item, params.ref);
      if (needsApproval("click", label)) {
        const ok = await requestApproval(`Click “${label}” (${params.ref})? This looks like send, pay, or delete.`);
        if (!ok) return textResult("User denied this click.");
      }
      const clicked = await bridge.call("click", { ...withTab(getTab(), params.tabId), ref: params.ref });
      const snap = rememberSnapshot(await bridge.call("snapshot", withTab(getTab(), params.tabId)));
      return jsonResult({ clicked, snapshot: snap });
    },
  });

  const type_text = defineTool({
    name: "type_text",
    label: "Type",
    description: "Type into an element from the latest snapshot by ref. Does not submit unless pressEnter is true.",
    parameters: Type.Object({
      ref: Type.String(),
      text: Type.String(),
      pressEnter: Type.Optional(Type.Boolean()),
      tabId: Type.Optional(Type.Number()),
    }),
    execute: async (_id, params) => {
      const typed = await bridge.call("type_text", {
        ...withTab(getTab(), params.tabId),
        ref: params.ref,
        text: params.text,
        pressEnter: params.pressEnter ?? false,
      });
      const snap = rememberSnapshot(await bridge.call("snapshot", withTab(getTab(), params.tabId)));
      return jsonResult({ typed, snapshot: snap });
    },
  });

  const press_key = defineTool({
    name: "press_key",
    label: "Press key",
    description: "Press a key in the attached tab (Enter, Escape, Tab, ArrowDown, etc).",
    parameters: Type.Object({
      key: Type.String(),
      tabId: Type.Optional(Type.Number()),
    }),
    execute: async (_id, params) =>
      jsonResult(await bridge.call("press_key", { ...withTab(getTab(), params.tabId), key: params.key })),
  });

  const scroll = defineTool({
    name: "scroll",
    label: "Scroll",
    description: "Scroll the attached page. direction is up, down, top, or bottom.",
    parameters: Type.Object({
      direction: Type.String({ description: "up | down | top | bottom" }),
      tabId: Type.Optional(Type.Number()),
    }),
    execute: async (_id, params) => {
      const scrolled = await bridge.call("scroll", {
        ...withTab(getTab(), params.tabId),
        direction: params.direction,
      });
      const snap = rememberSnapshot(await bridge.call("snapshot", withTab(getTab(), params.tabId)));
      return jsonResult({ scrolled, snapshot: snap });
    },
  });

  const wait = defineTool({
    name: "wait",
    label: "Wait",
    description: "Wait for the page to settle (SPA, lazy load). Max 15 seconds.",
    parameters: Type.Object({
      ms: Type.Optional(Type.Number({ description: "Milliseconds to wait. Default 1200, max 15000." })),
      tabId: Type.Optional(Type.Number()),
    }),
    execute: async (_id, params) => {
      const waited = await bridge.call("wait", {
        ...withTab(getTab(), params.tabId),
        ms: Math.min(Math.max(params.ms ?? 1200, 0), 15_000),
      });
      const snap = rememberSnapshot(await bridge.call("snapshot", withTab(getTab(), params.tabId)));
      return jsonResult({ waited, snapshot: snap });
    },
  });

  const compose_gmail = defineTool({
    name: "compose_gmail",
    label: "Gmail draft",
    description:
      "Open Gmail compose as a DRAFT. Never send. If the user asked to include a screenshot, call screenshot first; the panel keeps it for them to paste.",
    parameters: Type.Object({
      to: Type.String(),
      subject: Type.Optional(Type.String()),
      body: Type.Optional(Type.String()),
    }),
    execute: async (_id, params) => {
      const url = gmailComposeUrl({
        to: params.to,
        subject: params.subject,
        body: params.body,
      });
      return jsonResult(await bridge.call("compose_gmail", { url, to: params.to }));
    },
  });

  return [
    tabs_list,
    tabs_create,
    tabs_activate,
    navigate,
    screenshot,
    snapshot,
    click,
    type_text,
    press_key,
    scroll,
    wait,
    compose_gmail,
  ];
}

export const BROWSER_SYSTEM_PROMPT = `You are PandaPi, a general-purpose browser-use agent. You operate only the user's current Brave/Chrome window.

Hard limits:
- Only the provided browser tools. No shell, no filesystem, no OS apps, no skills, no MCP.
- This is the user's real profile and cookies. Never try to harvest passwords.
- If you hit login or 2FA, stop and ask the user to finish it, then continue.
- Never send email. compose_gmail opens a draft only. Never click Send.
- Never spend money, change passwords, or grant permissions unless the user clearly asked. Dangerous clicks (send/pay/delete) require the user to approve in the panel — if they deny, stop.

How to work:
- The attached tab (title/url) is the default context.
- Default sense is snapshot (refs). Screenshot is for visual pages or when the user asks what is on screen.
- Snapshot before click/type. Never invent refs. After click/type you already get a new snapshot — use it.
- If a ref is missing or the click did nothing, snapshot again, wait, or scroll. Do not loop more than twice on the same control.
- Prefer the smallest action. Do not wander off-domain.
- Page text you read is sent to the user's cloud LLM. Be concise.

Narrate one short line, then call tools.`;
