import fs from "node:fs";
import path from "node:path";

/** Read a JSON object from disk, returning {} for missing/corrupt files. */
export function readJsonObject(file: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Write JSON with owner-only (0600) permissions. */
export function writeSecretJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    /* best effort on platforms without chmod */
  }
}

/**
 * Merge an API key (and optional default model) into PandaPi's own agent home.
 * Never touches the Pi CLI's ~/.pi/agent.
 */
export function storePandapiKey(agentHome: string, provider: string, key: string, model?: string): void {
  const authPath = path.join(agentHome, "auth.json");
  const auth = readJsonObject(authPath);
  auth[provider] = { type: "api_key", key };
  writeSecretJson(authPath, auth);

  const trimmedModel = model?.trim();
  if (trimmedModel) {
    const settingsPath = path.join(agentHome, "settings.json");
    const settings = readJsonObject(settingsPath);
    settings.defaultProvider = provider;
    settings.defaultModel = trimmedModel;
    writeSecretJson(settingsPath, settings);
  }
}
