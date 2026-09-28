import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hostPath = path.join(root, "scripts", "pandapi-host.sh");
const extensionId = "kdocghhgibkeiaojckijeocmppbealaa";
const bunBin = process.execPath.includes("bun")
  ? process.execPath
  : Bun.which("bun") || "bun";

const manifest = {
  name: "com.pandapi.host",
  description: "PandaPi native host (Pi coding agent)",
  path: hostPath,
  type: "stdio",
  allowed_origins: [`chrome-extension://${extensionId}/`],
};

const dirs = [];
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
} else {
  console.error("Install the native host on Windows by copying the generated JSON into Brave's NativeMessagingHosts folder.");
}

fs.mkdirSync(path.dirname(hostPath), { recursive: true });
const launcher = `#!/usr/bin/env bash
set -euo pipefail
ROOT="${root}"
BUN="${bunBin}"
cd "$ROOT"
export PATH="$(dirname "$BUN"):$PATH"
exec "$BUN" "$ROOT/host/src/index.ts"
`;
fs.writeFileSync(hostPath, launcher, { mode: 0o755 });

let wrote = 0;
for (const dir of dirs) {
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, "com.pandapi.host.json");
  fs.writeFileSync(dest, JSON.stringify(manifest, null, 2) + "\n");
  console.log("Wrote", dest);
  wrote += 1;
}

console.log(`
PandaPi native host installed (${wrote} browser path(s)).
Host runtime: ${bunBin}

Next:
  1. Brave → brave://extensions → Developer mode
  2. Load unpacked → ${path.join(root, "extension")}
  3. Pin PandaPi and open the side panel
  4. Add a key just for this agent: bun run set-key
     (stored in ~/.pandapi, kept separate from the Pi CLI's ~/.pi/agent)

Optional Stagehand (this window only, no new profile):
  Start Brave with remote debugging, then:
  export PANDAPI_CDP_URL=http://127.0.0.1:9222
  Re-run bun run setup-host so the host process picks it up.
`);
