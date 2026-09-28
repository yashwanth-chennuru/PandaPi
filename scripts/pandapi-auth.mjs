#!/usr/bin/env bun
/**
 * Manage PandaPi's OWN provider credentials, isolated from the Pi CLI.
 *
 *   bun run set-key                      # prompt for a key (hidden), provider defaults to opencode-go
 *   bun run set-key --key sk-... --model kimi-k2.6
 *   bun run check-key                    # show what PandaPi can currently use
 *
 * Credentials are written to ~/.pandapi/auth.json (0600). The Pi CLI's
 * ~/.pi/agent is never touched, so usage is attributed to this key alone.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--key" || arg === "-k") out.key = argv[++i];
    else if (arg === "--provider" || arg === "-p") out.provider = argv[++i];
    else if (arg === "--model" || arg === "-m") out.model = argv[++i];
    else if (arg === "--home") out.home = argv[++i];
    else if (arg === "--check") out.check = true;
    else if (arg === "--help" || arg === "-h") out.help = true;
  }
  return out;
}

function printUsage() {
  console.log(`PandaPi credentials (kept separate from the Pi CLI)

Usage:
  bun run set-key [--key <api-key>] [--provider <id>] [--model <id>]
  bun run check-key

Options:
  -k, --key <key>        API key. If omitted, you are prompted (input hidden).
  -p, --provider <id>    Provider id. Default: opencode-go (OpenCode Go).
  -m, --model <id>       Default model id for this key (optional).
      --home <dir>       Agent directory. Default: $PANDAPI_HOME or ~/.pandapi
      --check            Print available models instead of writing a key.

Env fallbacks: PANDAPI_API_KEY, PANDAPI_PROVIDER, PANDAPI_MODEL, PANDAPI_HOME
`);
}

function resolveHome(cliHome) {
  return cliHome?.trim() || process.env.PANDAPI_HOME?.trim() || path.join(os.homedir(), ".pandapi");
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    /* best effort on platforms without chmod */
  }
}

async function promptHidden(label) {
  if (!process.stdin.isTTY) {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    return Buffer.concat(chunks).toString("utf8").trim();
  }
  process.stdout.write(label);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return await new Promise((resolve) => {
    let value = "";
    const onData = (buf) => {
      for (const ch of buf.toString("utf8")) {
        if (ch === "\r" || ch === "\n") {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.off("data", onData);
          process.stdout.write("\n");
          resolve(value.trim());
          return;
        }
        if (ch === "\u0003") {
          process.stdout.write("\n");
          process.exit(130);
        }
        if (ch === "\u007f") value = value.slice(0, -1);
        else value += ch;
      }
    };
    process.stdin.on("data", onData);
  });
}

async function check(agentHome) {
  const { ModelRuntime } = await import("@earendil-works/pi-coding-agent");
  const modelsStorePath = path.join(agentHome, "models-store.json");
  const runtime = await ModelRuntime.create({
    authPath: path.join(agentHome, "auth.json"),
    modelsPath: path.join(agentHome, "models.json"),
    modelsStorePath,
    allowModelNetwork: !fs.existsSync(modelsStorePath),
    modelRefreshTimeoutMs: 8000,
  });
  const available = await runtime.getAvailable();
  console.log(`PandaPi home: ${agentHome}`);
  if (available.length === 0) {
    console.log("No models: no usable key here yet. Run `bun run set-key`.");
    process.exitCode = 1;
    return;
  }
  console.log(`Available models (${available.length}):`);
  for (const model of available) {
    console.log(`  ${model.provider}/${model.id}${model.name ? `  (${model.name})` : ""}`);
  }
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  printUsage();
  process.exit(0);
}

const agentHome = resolveHome(args.home);
fs.mkdirSync(agentHome, { recursive: true });

if (args.check) {
  await check(agentHome);
  process.exit(process.exitCode ?? 0);
}

const provider = (args.provider || process.env.PANDAPI_PROVIDER || "opencode-go").trim();
let key = (args.key || process.env.PANDAPI_API_KEY || "").trim();
if (!key) {
  key = await promptHidden(`Paste your ${provider} API key (input hidden): `);
}
if (!key) {
  console.error("No API key provided.");
  process.exit(1);
}

const authPath = path.join(agentHome, "auth.json");
const auth = readJson(authPath);
auth[provider] = { type: "api_key", key };
writeJson(authPath, auth);
console.log(`Wrote ${authPath} (provider: ${provider}, 0600).`);

const model = (args.model || process.env.PANDAPI_MODEL || "").trim();
if (model) {
  const settingsPath = path.join(agentHome, "settings.json");
  const settings = readJson(settingsPath);
  settings.defaultProvider = provider;
  settings.defaultModel = model;
  writeJson(settingsPath, settings);
  console.log(`Set default model: ${provider}/${model} (${settingsPath}).`);
}

console.log(`
PandaPi now uses its own key. The Pi CLI (~/.pi/agent) is untouched.
To monitor this agent separately, create a dedicated key in your provider
dashboard and use it only here.

Next:
  1. Verify:  bun run check-key
  2. In Brave: close and reopen the PandaPi side panel (restarts the host).
`);
