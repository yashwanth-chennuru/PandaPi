import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type LlmConfig = {
  baseUrl: string;
  apiKey: string;
  modelId: string;
  providerId: string;
};

export const PROVIDER_ID = "compat";

export function pandapiHome(): string {
  return process.env.PANDAPI_HOME?.trim() || path.join(os.homedir(), ".pandapi");
}

export function modelsPath(home = pandapiHome()): string {
  return path.join(home, "models.json");
}

export function authPath(home = pandapiHome()): string {
  return path.join(home, "auth.json");
}

function chmodSafe(target: string, mode: number) {
  try {
    fs.chmodSync(target, mode);
  } catch {
    /* Windows may ignore; best-effort */
  }
}

export function ensureHome(home = pandapiHome()): string {
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  chmodSafe(home, 0o700);
  return home;
}

export function readLlmConfig(home = pandapiHome()): LlmConfig | null {
  const file = modelsPath(home);
  if (!fs.existsSync(file)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as {
      providers?: Record<
        string,
        { baseUrl?: string; apiKey?: string; models?: Array<{ id?: string }> }
      >;
    };
    const provider = raw.providers?.[PROVIDER_ID];
    if (!provider?.baseUrl) return null;
    const modelId = provider.models?.[0]?.id || "gpt-4.1";
    const apiKey = resolveKey(provider.apiKey);
    if (!apiKey) return null;
    return {
      providerId: PROVIDER_ID,
      baseUrl: provider.baseUrl.replace(/\/+$/, ""),
      apiKey,
      modelId,
    };
  } catch {
    return null;
  }
}

function resolveKey(value: string | undefined): string {
  if (!value) return "";
  const env = value.match(/^\$([A-Z][A-Z0-9_]*)$/);
  if (env) return process.env[env[1]] ?? "";
  return value;
}

export function seedFromEnv(home = pandapiHome()): LlmConfig | null {
  const existing = readLlmConfig(home);
  if (existing) return existing;
  const apiKey = process.env.PANDAPI_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const baseUrl =
    process.env.PANDAPI_BASE_URL || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  const modelId = process.env.PANDAPI_MODEL || "gpt-4.1";
  writeLlmConfig({ baseUrl, apiKey, modelId, providerId: PROVIDER_ID }, home);
  return readLlmConfig(home);
}

export function writeLlmConfig(cfg: LlmConfig, home = pandapiHome()): void {
  ensureHome(home);
  const file = modelsPath(home);
  const payload = {
    providers: {
      [PROVIDER_ID]: {
        baseUrl: cfg.baseUrl.replace(/\/+$/, ""),
        api: "openai-completions",
        apiKey: cfg.apiKey,
        authHeader: true,
        compat: {
          supportsStore: false,
          supportsDeveloperRole: false,
          supportsReasoningEffort: false,
          supportsUsageInStreaming: false,
          supportsStrictMode: false,
          maxTokensField: "max_tokens",
        },
        models: [
          {
            id: cfg.modelId,
            name: cfg.modelId,
            reasoning: false,
            input: ["text", "image"],
            contextWindow: 128000,
            maxTokens: 8192,
          },
        ],
      },
    },
  };
  fs.writeFileSync(file, JSON.stringify(payload, null, 2) + "\n", { mode: 0o600 });
  chmodSafe(file, 0o600);
  chmodSafe(home, 0o700);
}

export function publicConfig(cfg: LlmConfig | null): {
  baseUrl: string;
  modelId: string;
  hasKey: boolean;
  keyHint: string;
} {
  if (!cfg) return { baseUrl: "https://api.openai.com/v1", modelId: "gpt-4.1", hasKey: false, keyHint: "" };
  const key = cfg.apiKey;
  const keyHint = key.length <= 8 ? "••••" : `${key.slice(0, 4)}…${key.slice(-4)}`;
  return { baseUrl: cfg.baseUrl, modelId: cfg.modelId, hasKey: true, keyHint };
}
