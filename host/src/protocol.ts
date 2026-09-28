import os from "node:os";
import path from "node:path";

export const NATIVE_HOST_NAME = "com.pandapi.host";

/**
 * PandaPi's own agent directory. Deliberately separate from the Pi CLI's
 * `~/.pi/agent` so the browser agent never reads or writes the CLI's keys,
 * settings, model catalog, or extensions. Override with `PANDAPI_HOME`.
 */
export function resolvePandapiHome(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.PANDAPI_HOME?.trim();
  return override || path.join(os.homedir(), ".pandapi");
}

export type TabContext = {
  tabId: number;
  windowId: number;
  title: string;
  url: string;
  favIconUrl?: string;
};

export type ClientMessage =
  | { type: "hello" }
  | { type: "prompt"; id: string; text: string; tab: TabContext | null }
  | { type: "abort" }
  | { type: "new_session" }
  | { type: "set_model"; provider: string; modelId: string }
  | { type: "browser_result"; id: string; ok: boolean; result?: unknown; error?: string };

export type AgentEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_start"; name: string; detail?: string }
  | { type: "tool_end"; name: string; detail?: string }
  | { type: "error"; message: string }
  | { type: "done" };

export type HostMessage =
  | {
      type: "hello_ok";
      models: Array<{ provider: string; id: string; name?: string }>;
      model: { provider: string; id: string } | null;
      stagehand: boolean;
      piReady: boolean;
      warning?: string;
    }
  | { type: "hello_error"; message: string }
  | { type: "event"; id: string; event: AgentEvent }
  | { type: "browser_request"; id: string; method: string; params: Record<string, unknown> };

export type BrowserMethod =
  | "tabs_list"
  | "tabs_create"
  | "tabs_activate"
  | "navigate"
  | "screenshot"
  | "snapshot"
  | "page_text"
  | "click"
  | "type_text"
  | "press_key"
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

/** Split a `data:<mime>;base64,<payload>` URL into the parts a Pi image block needs. */
export function parseDataUrl(dataUrl: string): { mimeType: string; base64: string } | null {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl);
  if (!match) return null;
  return { mimeType: match[1], base64: match[2] };
}

/**
 * Pick the session's starting model. Prefers the user's Pi default
 * (provider/model from `~/.pi/agent/settings.json`) and falls back to the
 * first available model.
 */
export function pickInitialModel<T extends { provider: string; id: string }>(
  available: readonly T[],
  preferred: { provider?: string; id?: string } | undefined,
): T | undefined {
  if (preferred?.provider && preferred.id) {
    const match = available.find((m) => m.provider === preferred.provider && m.id === preferred.id);
    if (match) return match;
  }
  return available[0];
}
