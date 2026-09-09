#!/usr/bin/env bun
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionId = "kdocghhgibkeiaojckijeocmppbealaa";
const bunBin = process.execPath.includes("bun")
  ? process.execPath
  : Bun.which("bun") || "bun";

const isWin = process.platform === "win32";
const hostPath = path.join(root, "scripts", isWin ? "pandapi-host.cmd" : "pandapi-host.sh");

const manifest = {
  name: "com.pandapi.host",
  description: "PandaPi native host (isolated Pi harness)",
  path: hostPath,
  type: "stdio",
  allowed_origins: [`chrome-extension://${extensionId}/`],
};

/** @type {string[]} */
const dirs = [];
/** @type {Array<{ hive: string; key: string }>} */
const winRegistry = [];

if (process.platform === "darwin") {
  dirs.push(
    path.join(os.homedir(), "Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts"),
    path.join(os.homedir(), "Library/Application Support/Google/Chrome/NativeMessagingHosts"),
    path.join(os.homedir(), "Library/Application Support/Chromium/NativeMessagingHosts"),
  );
} else if (process.platform === "linux") {
  dirs.push(
    path.join(os.homedir(), ".config/BraveSoftware/Brave-Browser/NativeMessagingHosts"),
    path.join(os.homedir(), ".config/google-chrome/NativeMessagingHosts"),
    path.join(os.homedir(), ".config/chromium/NativeMessagingHosts"),
  );
} else if (isWin) {
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  dirs.push(
    path.join(local, "BraveSoftware", "Brave-Browser", "User Data", "NativeMessagingHosts"),
    path.join(local, "Google", "Chrome", "User Data", "NativeMessagingHosts"),
    path.join(local, "Chromium", "User Data", "NativeMessagingHosts"),
  );
  winRegistry.push(
    {
      hive: "HKCU",
      key: `Software\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts\\com.pandapi.host`,
    },
    {
      hive: "HKCU",
      key: `Software\\Google\\Chrome\\NativeMessagingHosts\\com.pandapi.host`,
    },
    {
      hive: "HKCU",
      key: `Software\\Chromium\\NativeMessagingHosts\\com.pandapi.host`,
    },
  );
} else {
  console.error(`Unsupported platform: ${process.platform}`);
  process.exit(1);
}

fs.mkdirSync(path.dirname(hostPath), { recursive: true });

if (isWin) {
  const launcher = `@echo off
setlocal
set "ROOT=${root.replace(/\//g, "\\")}"
set "BUN=${bunBin.replace(/\//g, "\\")}"
cd /d "%ROOT%"
set "PI_CODING_AGENT_DIR="
set "PI_AGENT_DIR="
if not defined PANDAPI_HOME set "PANDAPI_HOME=%USERPROFILE%\\.pandapi"
"%BUN%" "%ROOT%\\host\\src\\index.ts"
`;
  fs.writeFileSync(hostPath, launcher.replace(/\n/g, "\r\n"));
} else {
  const launcher = `#!/usr/bin/env bash
set -euo pipefail
ROOT="${root}"
BUN="${bunBin}"
cd "$ROOT"
unset PI_CODING_AGENT_DIR PI_AGENT_DIR
export PATH="$(dirname "$BUN"):$PATH"
export PANDAPI_HOME="\${PANDAPI_HOME:-$HOME/.pandapi}"
exec "$BUN" "$ROOT/host/src/index.ts"
`;
  fs.writeFileSync(hostPath, launcher, { mode: 0o755 });
}

let wrote = 0;
const manifestJson = JSON.stringify(manifest, null, 2) + "\n";
for (const dir of dirs) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, "com.pandapi.host.json");
    fs.writeFileSync(dest, manifestJson);
    console.log("Wrote", dest);
    wrote += 1;
  } catch (err) {
    console.error("Could not write", dir, "—", err instanceof Error ? err.message : err);
  }
}

if (isWin) {
  // Chrome/Brave on Windows also require a registry value pointing at the manifest JSON.
  const primaryManifest = path.join(dirs[0], "com.pandapi.host.json");
  for (const { hive, key } of winRegistry) {
    const result = spawnSync(
      "reg",
      ["add", `${hive}\\${key}`, "/ve", "/t", "REG_SZ", "/d", primaryManifest, "/f"],
      { encoding: "utf8" },
    );
    if (result.status === 0) {
      console.log("Registered", `${hive}\\${key}`);
      wrote += 1;
    } else {
      console.error(
        "Could not register",
        `${hive}\\${key}`,
        "—",
        (result.stderr || result.stdout || "").trim() || `exit ${result.status}`,
      );
    }
  }
}

if (wrote === 0) {
  console.error(`
PandaPi native host installation FAILED — zero browser paths were registered.
Fix permissions / install a Chromium browser, then re-run: bun run setup-host
`);
  process.exit(1);
}

console.log(`
PandaPi native host installed (${wrote} path(s)/registry entries).
Host launcher: ${hostPath}
Host runtime: ${bunBin}
Isolated Pi home: ~/.pandapi (not ~/.pi/agent)

Next:
  1. Brave → brave://extensions → Developer mode
  2. Load unpacked → ${path.join(root, "extension")}
  3. Open the PandaPi side panel and paste an OpenAI-compatible base URL + API key
`);
