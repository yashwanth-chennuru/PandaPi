import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hostPath = path.join(root, "scripts", "pandapi-host.sh");
const extensionId = "kdocghhgibkeiaojckijeocmppbealaa";

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
cd "$ROOT"
if [[ -x "$ROOT/node_modules/.bin/tsx" ]]; then
  exec "$ROOT/node_modules/.bin/tsx" "$ROOT/host/src/index.ts"
fi
exec node "$ROOT/dist/index.js"
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

Next:
  1. Brave → brave://extensions → Developer mode
  2. Load unpacked → ${path.join(root, "extension")}
  3. Pin PandaPi and open the side panel
  4. Pi keys stay in ~/.pi/agent (same as the CLI)

Optional Stagehand (this window only, no new profile):
  Start Brave with remote debugging, then:
  export PANDAPI_CDP_URL=http://127.0.0.1:9222
  Re-run npm run install-host so the host process picks it up.
`);
