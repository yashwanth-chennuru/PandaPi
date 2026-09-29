export const NATIVE_HOST_NAME = "com.pandapi.host";

export type TabContext = {
  tabId: number;
  windowId: number;
  title: string;
  url: string;
  favIconUrl?: string;
};

export type ClientMessage =
  | { type: "hello"; panelId?: string }
  | { type: "prompt"; id: string; text: string; tab: TabContext | null; panelId?: string }
  | { type: "abort"; panelId?: string }
  | { type: "new_session"; panelId?: string }
  | { type: "set_model"; provider: string; modelId: string; panelId?: string }
  | { type: "set_config"; baseUrl: string; apiKey: string; modelId: string; panelId?: string }
  | { type: "approval_result"; id: string; allow: boolean; panelId?: string }
  | { type: "browser_result"; id: string; ok: boolean; result?: unknown; error?: string; panelId?: string };

export type AgentEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_start"; name: string; detail?: string }
  | { type: "tool_end"; name: string; detail?: string }
  | { type: "error"; message: string }
  | { type: "done" };

export type PublicLlm = {
  baseUrl: string;
  modelId: string;
  hasKey: boolean;
  keyHint: string;
};

export type HostMessage =
  | {
      type: "hello_ok";
      models: Array<{ provider: string; id: string; name?: string }>;
      model: { provider: string; id: string } | null;
      piReady: boolean;
      llm: PublicLlm;
      warning?: string;
      panelId?: string;
    }
  | { type: "hello_error"; message: string; panelId?: string }
  | { type: "event"; id: string; event: AgentEvent; panelId?: string }
  | {
      type: "browser_request";
      id: string;
      method: string;
      params: Record<string, unknown>;
      panelId?: string;
    }
  | { type: "approval_request"; id: string; summary: string; panelId?: string }
  | { type: "approval_resolved"; id: string; allow: boolean; panelId?: string };

export type BrowserMethod =
  | "tabs_list"
  | "tabs_create"
  | "tabs_activate"
  | "navigate"
  | "screenshot"
  | "snapshot"
  | "click"
  | "type_text"
  | "press_key"
  | "scroll"
  | "describe"
  | "wait"
  | "compose_gmail";

export function encodeNativeMessage(payload: unknown): Buffer {
  const json = Buffer.from(JSON.stringify(payload), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(json.length, 0);
  return Buffer.concat([header, json]);
}

export function createNativeDecoder(): {
  push(chunk: Buffer): unknown[];
} {
  let buf = Buffer.alloc(0);
  return {
    push(chunk: Buffer): unknown[] {
      buf = Buffer.concat([buf, chunk]);
      const out: unknown[] = [];
      while (buf.length >= 4) {
        const len = buf.readUInt32LE(0);
        if (len > 64 * 1024 * 1024) {
          throw new Error(`Native message too large: ${len}`);
        }
        if (buf.length < 4 + len) break;
        const json = buf.subarray(4, 4 + len).toString("utf8");
        buf = buf.subarray(4 + len);
        out.push(JSON.parse(json));
      }
      return out;
    },
  };
}

export function gmailComposeUrl(input: {
  to: string;
  subject?: string;
  body?: string;
}): string {
  const params = new URLSearchParams({ view: "cm", fs: "1", to: input.to });
  if (input.subject) params.set("su", input.subject);
  if (input.body) params.set("body", input.body);
  return `https://mail.google.com/mail/?${params.toString()}`;
}

/**
 * Validate a URL before it is handed to `chrome.tabs` navigation.
 * Only http(s) and the scriptable `about:blank` are allowed, so a
 * prompt-injected model cannot navigate to `javascript:`, `data:`, `file:`,
 * extension pages, or a relative path it does not control.
 */
export function assertNavigableUrl(raw: string): string {
  const value = raw.trim();
  if (!value) throw new Error("Refusing to navigate: empty URL.");
  if (value === "about:blank") return value;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Refusing to navigate: not an absolute URL: ${raw}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Refusing to navigate to a ${parsed.protocol} URL. Only http(s) is allowed.`);
  }
  return parsed.toString();
}
