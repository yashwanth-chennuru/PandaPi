import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { gmailComposeUrl } from "./protocol.js";
import type { TabContext } from "./protocol.js";
import type { StagehandHandle } from "./stagehand.js";

export type BrowserBridge = {
  call: (method: string, params: Record<string, unknown>) => Promise<unknown>;
};

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
  "compose_gmail",
  "page_act",
  "page_extract",
] as const;

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }], details: {} };
}

function jsonResult(value: unknown) {
  return textResult(typeof value === "string" ? value : JSON.stringify(value, null, 2));
}

function withTab(
  tab: TabContext | null | undefined,
  tabId?: number,
): Record<string, unknown> {
  const id = tabId ?? tab?.tabId;
  if (id == null) throw new Error("No attached tab. Ask the user to keep a page chip attached.");
  return { tabId: id };
}

export function createBrowserTools(opts: {
  getTab: () => TabContext | null;
  bridge: BrowserBridge;
  getStagehand: () => StagehandHandle | null;
}) {
  const { getTab, bridge, getStagehand } = opts;

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
      url: Type.Optional(Type.String({ description: "URL to open. Defaults to a new tab page." })),
      active: Type.Optional(Type.Boolean({ description: "Focus the new tab. Default true." })),
    }),
    execute: async (_id, params) =>
      jsonResult(await bridge.call("tabs_create", { url: params.url, active: params.active })),
  });

  const tabs_activate = defineTool({
    name: "tabs_activate",
    label: "Switch tab",
    description: "Focus an existing tab by id.",
    parameters: Type.Object({
      tabId: Type.Number({ description: "Tab id from tabs_list" }),
    }),
    execute: async (_id, params) => jsonResult(await bridge.call("tabs_activate", { tabId: params.tabId })),
  });

  const navigate = defineTool({
    name: "navigate",
    label: "Navigate",
    description: "Navigate the attached tab (or a given tab id) to a URL.",
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
    description: "Capture a screenshot of the visible attached tab. Use this when the user asks to screenshot or to include the screen in an email.",
    parameters: Type.Object({
      tabId: Type.Optional(Type.Number()),
    }),
    execute: async (_id, params) => {
      const result = (await bridge.call("screenshot", withTab(getTab(), params.tabId))) as {
        mimeType?: string;
        note?: string;
        width?: number;
        height?: number;
      };
      return {
        content: [
          {
            type: "text" as const,
            text: result.note ?? `Screenshot captured (${result.width ?? "?"}x${result.height ?? "?"}, ${result.mimeType ?? "image"}). The image is in the side panel for the user.`,
          },
        ],
        details: result,
      };
    },
  });

  const snapshot = defineTool({
    name: "snapshot",
    label: "Page snapshot",
    description:
      "Accessibility-style snapshot of the attached page with numeric refs for interactive elements. Call this before click/type.",
    parameters: Type.Object({
      tabId: Type.Optional(Type.Number()),
    }),
    execute: async (_id, params) => jsonResult(await bridge.call("snapshot", withTab(getTab(), params.tabId))),
  });

  const click = defineTool({
    name: "click",
    label: "Click",
    description: "Click an element from the latest snapshot by ref (e.g. e12).",
    parameters: Type.Object({
      ref: Type.String({ description: "Ref from snapshot, like e12" }),
      tabId: Type.Optional(Type.Number()),
    }),
    execute: async (_id, params) =>
      jsonResult(await bridge.call("click", { ...withTab(getTab(), params.tabId), ref: params.ref })),
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
    execute: async (_id, params) =>
      jsonResult(
        await bridge.call("type_text", {
          ...withTab(getTab(), params.tabId),
          ref: params.ref,
          text: params.text,
          pressEnter: params.pressEnter ?? false,
        }),
      ),
  });

  const press_key = defineTool({
    name: "press_key",
    label: "Press key",
    description: "Press a key in the attached tab (Enter, Escape, Tab, etc).",
    parameters: Type.Object({
      key: Type.String(),
      tabId: Type.Optional(Type.Number()),
    }),
    execute: async (_id, params) =>
      jsonResult(await bridge.call("press_key", { ...withTab(getTab(), params.tabId), key: params.key })),
  });

  const compose_gmail = defineTool({
    name: "compose_gmail",
    label: "Gmail draft",
    description:
      "Open Gmail compose in the browser as a DRAFT. Never send. Include to/subject/body. If the user asked to include a screenshot, call screenshot first; the panel keeps it for the user to paste/attach.",
    parameters: Type.Object({
      to: Type.String({ description: "Recipient email" }),
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

  const page_act = defineTool({
    name: "page_act",
    label: "Act on page",
    description:
      "Natural-language action on the attached page (click the login button, search for X). Uses Stagehand when a local CDP attach is configured; otherwise tells you to use snapshot+click.",
    parameters: Type.Object({
      instruction: Type.String(),
      tabId: Type.Optional(Type.Number()),
    }),
    execute: async (_id, params) => {
      const sh = getStagehand();
      if (sh) {
        const out = await sh.act(params.instruction);
        return jsonResult(out);
      }
      return textResult(
        "Stagehand is not attached (no local CDP). Take a snapshot of the attached tab, then click/type using refs. Do not invent refs.",
      );
    },
  });

  const page_extract = defineTool({
    name: "page_extract",
    label: "Extract from page",
    description:
      "Extract structured facts from the attached page. Uses Stagehand when attached; otherwise returns the snapshot text for you to read.",
    parameters: Type.Object({
      instruction: Type.String(),
      tabId: Type.Optional(Type.Number()),
    }),
    execute: async (_id, params) => {
      const sh = getStagehand();
      if (sh) {
        const out = await sh.extract(params.instruction);
        return jsonResult(out);
      }
      const snap = await bridge.call("snapshot", withTab(getTab(), params.tabId));
      return jsonResult({
        note: "Stagehand not attached; snapshot follows. Extract from this text.",
        snapshot: snap,
        instruction: params.instruction,
      });
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
    compose_gmail,
    page_act,
    page_extract,
  ];
}

export const BROWSER_SYSTEM_PROMPT = `You are PandaPi, a browser-only agent. You run inside the user's current Brave/Chrome window.

Hard limits:
- You may only use the provided browser tools. You have no shell, no filesystem, no local folders, no OS apps.
- You operate the user's existing profile and cookies. Do not try to create profiles or log in with stored passwords.
- If a site shows a login or 2FA wall, stop and tell the user to finish login, then continue.
- Never send email. compose_gmail opens a draft only. Never click Send.
- Never spend money, change passwords, or grant permissions without the user explicitly asking and a clear warning.

How to work:
- The attached tab (title/url) is the default context. Use tabs_list if you need another tab.
- For "what's on screen", screenshot and/or snapshot. Snapshot before click/type.
- For "open a new tab", use tabs_create.
- For Gmail: compose_gmail with the exact address the user gave. If they asked to include a screenshot, screenshot first, then compose. Tell them the screenshot is in the side panel to paste/attach; do not claim you attached a file unless a tool result says so.
- Prefer the smallest action. Do not wander off-domain.

Be concise. Narrate what you are about to do in one short line, then call tools.`;
