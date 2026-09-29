import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { needsApproval } from "./danger.js";
import { assertNavigableUrl, gmailComposeUrl, type TabContext } from "./protocol.js";

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

export type SnapshotItem = { ref: string; name?: string; role?: string; href?: string };

export type SnapshotBinding = {
  tabId: number;
  url: string;
  generation: string;
  items: SnapshotItem[];
};

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }], details: {} };
}

function jsonResult(value: unknown) {
  return textResult(typeof value === "string" ? value : JSON.stringify(value, null, 2));
}

function imageResult(note: string, dataUrl: string, mimeType: string) {
  const base64 = dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
  return {
    content: [
      { type: "text" as const, text: note },
      { type: "image" as const, data: base64, mimeType },
    ],
    details: { mimeType },
  };
}

function withTab(tab: TabContext | null | undefined, tabId?: number): { tabId: number } {
  const id = tabId ?? tab?.tabId;
  if (id == null) throw new Error("No attached tab. Keep a page chip attached, or pass tabId.");
  return { tabId: id };
}

function itemLabel(item: SnapshotItem | undefined, fallback: string): string {
  return (item?.name || item?.role || fallback).trim();
}

function controlDescriptor(live: { tag?: string; type?: string }): string {
  const bits = [live.tag, live.type].filter(Boolean);
  return bits.length ? bits.join(" ") : "control";
}

export function createBrowserTools(opts: {
  getTab: () => TabContext | null;
  bridge: BrowserBridge;
  requestApproval: ApprovalFn;
  getSnapshot: () => SnapshotBinding | null;
  setSnapshot: (snap: SnapshotBinding | null) => void;
}) {
  const { getTab, bridge, requestApproval, getSnapshot, setSnapshot } = opts;

  const rememberSnapshot = (raw: unknown, tabId: number): unknown => {
    if (!raw || typeof raw !== "object") return raw;
    const obj = raw as {
      items?: SnapshotItem[];
      url?: string;
      generation?: string;
      tabId?: number;
    };
    if (!Array.isArray(obj.items)) return raw;
    setSnapshot({
      tabId: obj.tabId ?? tabId,
      url: obj.url || "",
      generation: obj.generation || `${Date.now()}`,
      items: obj.items,
    });
    return raw;
  };

  /**
   * The formatted snapshot text is the only part the model needs; `items` and
   * the raw page text are kept host-side for ref resolution. Returning the
   * whole payload here would send the page content to the LLM twice.
   */
  const snapshotText = (raw: unknown): string => {
    if (raw && typeof raw === "object" && "text" in raw) {
      const text = (raw as { text?: unknown }).text;
      if (typeof text === "string") return text;
    }
    return typeof raw === "string" ? raw : JSON.stringify(raw);
  };

  const resolveRef = async (ref: string, tabId: number) => {
    const snap = getSnapshot();
    if (!snap || snap.tabId !== tabId) {
      throw new Error(
        `Ref ${ref} is not bound to tab ${tabId}. Call snapshot on this tab first (refs are per-tab and expire on navigation).`,
      );
    }
    const live = (await bridge.call("describe", { tabId, ref })) as {
      ok?: boolean;
      error?: string;
      name?: string;
      tag?: string;
      type?: string;
      href?: string;
      url?: string;
    };
    if (!live?.ok) {
      throw new Error(live?.error || `Ref ${ref} is stale on tab ${tabId}. Take a new snapshot.`);
    }
    if (snap.url && live.url && snap.url !== live.url) {
      throw new Error(
        `Page changed since snapshot (${snap.url} → ${live.url}). Take a new snapshot before acting.`,
      );
    }
    const cached = snap.items.find((it) => it.ref === ref);
    return {
      label: itemLabel(
        { ref, name: live.name || cached?.name, role: live.tag || cached?.role, href: live.href || cached?.href },
        ref,
      ),
      live,
      cached,
    };
  };

  const tabs_list = defineTool({
    name: "tabs_list",
    label: "List tabs",
    description: "List open tabs in the attached tab's window.",
    parameters: Type.Object({}),
    execute: async () => {
      const tab = getTab();
      return jsonResult(await bridge.call("tabs_list", tab ? { windowId: tab.windowId } : {}));
    },
  });

  const tabs_create = defineTool({
    name: "tabs_create",
    label: "New tab",
    description: "Open a new tab in the attached tab's window. Optionally navigate it to a URL.",
    parameters: Type.Object({
      url: Type.Optional(Type.String({ description: "URL to open. Defaults to about:blank." })),
      active: Type.Optional(Type.Boolean()),
    }),
    execute: async (_id, params) => {
      const url = params.url ? assertNavigableUrl(params.url) : "about:blank";
      const tab = getTab();
      return jsonResult(
        await bridge.call("tabs_create", { url, active: params.active, windowId: tab?.windowId }),
      );
    },
  });

  const tabs_activate = defineTool({
    name: "tabs_activate",
    label: "Switch tab",
    description: "Focus an existing tab by id from tabs_list.",
    parameters: Type.Object({
      tabId: Type.Number(),
    }),
    execute: async (_id, params) => {
      setSnapshot(null);
      return jsonResult(await bridge.call("tabs_activate", { tabId: params.tabId }));
    },
  });

  const navigate = defineTool({
    name: "navigate",
    label: "Navigate",
    description: "Navigate the attached tab to a URL and wait until load completes. Invalidates snapshot refs.",
    parameters: Type.Object({
      url: Type.String(),
      tabId: Type.Optional(Type.Number()),
    }),
    execute: async (_id, params) => {
      setSnapshot(null);
      const url = assertNavigableUrl(params.url);
      return jsonResult(await bridge.call("navigate", { ...withTab(getTab(), params.tabId), url }));
    },
  });

  const screenshot = defineTool({
    name: "screenshot",
    label: "Screenshot",
    description:
      "Capture the visible tab and return the image to the model (also shown in the side panel). Prefer snapshot for structure; use this for charts, canvas, maps, or visual-only pages.",
    parameters: Type.Object({
      tabId: Type.Optional(Type.Number()),
    }),
    execute: async (_id, params) => {
      const { tabId } = withTab(getTab(), params.tabId);
      const result = (await bridge.call("screenshot", { tabId })) as {
        note?: string;
        dataUrl?: string;
        mimeType?: string;
      };
      if (!result?.dataUrl) {
        return textResult(result?.note ?? "Screenshot failed: no image data.");
      }
      return imageResult(
        result.note ?? "Screenshot captured and attached for vision.",
        result.dataUrl,
        result.mimeType || "image/png",
      );
    },
  });

  const snapshot = defineTool({
    name: "snapshot",
    label: "Page snapshot",
    description:
      "Page text plus interactive refs (e1, e2, …). Call before click/type. Refs are bound to this tab+URL and become invalid after navigation. Do not invent refs.",
    parameters: Type.Object({
      tabId: Type.Optional(Type.Number()),
    }),
    execute: async (_id, params) => {
      const { tabId } = withTab(getTab(), params.tabId);
      const raw = await bridge.call("snapshot", { tabId });
      rememberSnapshot(raw, tabId);
      return jsonResult(snapshotText(raw));
    },
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
      const { tabId } = withTab(getTab(), params.tabId);
      const { label, live } = await resolveRef(params.ref, tabId);
      if (needsApproval("click", label, { tag: live.tag, type: live.type, href: live.href })) {
        const ok = await requestApproval(
          `Click “${label}” (${params.ref}, <${controlDescriptor(live)}>) on tab ${tabId}? This looks like send, pay, delete, publish, or confirm.`,
        );
        if (!ok) return textResult("User denied this click.");
      }
      const clicked = await bridge.call("click", { tabId, ref: params.ref });
      const raw = await bridge.call("snapshot", { tabId });
      rememberSnapshot(raw, tabId);
      return jsonResult({ clicked, snapshot: snapshotText(raw) });
    },
  });

  const type_text = defineTool({
    name: "type_text",
    label: "Type",
    description: "Type into a text field from the latest snapshot by ref. pressEnter submits the form and requires approval.",
    parameters: Type.Object({
      ref: Type.String(),
      text: Type.String(),
      pressEnter: Type.Optional(Type.Boolean()),
      tabId: Type.Optional(Type.Number()),
    }),
    execute: async (_id, params) => {
      const { tabId } = withTab(getTab(), params.tabId);
      const pressEnter = Boolean(params.pressEnter);
      const { label, live } = await resolveRef(params.ref, tabId);
      if (needsApproval("type_text", label, { pressEnter, tag: live.tag, type: live.type, href: live.href })) {
        const ok = await requestApproval(
          pressEnter
            ? `Type into “${label}” (${params.ref}, <${controlDescriptor(live)}>) and press Enter (may submit)?`
            : `Type into “${label}” (${params.ref}, <${controlDescriptor(live)}>)?`,
        );
        if (!ok) return textResult("User denied this typing action.");
      }
      const typed = await bridge.call("type_text", {
        tabId,
        ref: params.ref,
        text: params.text,
        pressEnter,
      });
      const raw = await bridge.call("snapshot", { tabId });
      rememberSnapshot(raw, tabId);
      return jsonResult({ typed, snapshot: snapshotText(raw) });
    },
  });

  const press_key = defineTool({
    name: "press_key",
    label: "Press key",
    description: "Press a key in the attached tab (Enter, Escape, Tab, ArrowDown, etc). Enter requires approval because it can submit forms.",
    parameters: Type.Object({
      key: Type.String(),
      tabId: Type.Optional(Type.Number()),
    }),
    execute: async (_id, params) => {
      const { tabId } = withTab(getTab(), params.tabId);
      if (needsApproval("press_key", undefined, { key: params.key })) {
        const ok = await requestApproval(`Press ${params.key} on tab ${tabId}? This may submit a form or trigger a control.`);
        if (!ok) return textResult("User denied this key press.");
      }
      return jsonResult(await bridge.call("press_key", { tabId, key: params.key }));
    },
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
      const { tabId } = withTab(getTab(), params.tabId);
      const scrolled = await bridge.call("scroll", { tabId, direction: params.direction });
      const raw = await bridge.call("snapshot", { tabId });
      rememberSnapshot(raw, tabId);
      return jsonResult({ scrolled, snapshot: snapshotText(raw) });
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
      const { tabId } = withTab(getTab(), params.tabId);
      const waited = await bridge.call("wait", {
        tabId,
        ms: Math.min(Math.max(params.ms ?? 1200, 0), 15_000),
      });
      const raw = await bridge.call("snapshot", { tabId });
      rememberSnapshot(raw, tabId);
      return jsonResult({ waited, snapshot: snapshotText(raw) });
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
- Never spend money, change passwords, or grant permissions unless the user clearly asked. Dangerous actions (send/pay/delete/confirm/Enter-submit) require the user to approve in the panel — if they deny, stop.

How to work:
- The attached tab (title/url) is the default context.
- Call snapshot before acting. Snapshot includes page text AND interactive refs. Use the page text for summarization; use refs for click/type.
- Refs are bound to one tab + URL generation. After navigate/tab switch they are invalid — snapshot again. Never invent refs or reuse refs across tabs.
- Screenshot returns an image to you for vision. Prefer snapshot for structure; screenshot for charts/canvas/maps.
- After click/type you get a fresh snapshot — use it.
- If a ref is missing or the click did nothing, snapshot again, wait, or scroll. Do not loop more than twice on the same control.
- Prefer the smallest action. Do not wander off-domain.
- Page text and screenshots you read are sent to the user's cloud LLM. Be concise.

Narrate one short line, then call tools.`;
