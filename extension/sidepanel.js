const logEl = document.getElementById("log");
const emptyEl = document.getElementById("empty");
const input = document.getElementById("input");
const sendBtn = document.getElementById("send");
const abortBtn = document.getElementById("abort");
const modelEl = document.getElementById("model");
const banner = document.getElementById("banner");
const statusDot = document.getElementById("statusDot");
const tabCard = document.getElementById("tabCard");
const tabTitle = document.getElementById("tabTitle");
const tabUrl = document.getElementById("tabUrl");
const tabFav = document.getElementById("tabFav");
const shotWrap = document.getElementById("shotWrap");
const shot = document.getElementById("shot");
const settingsEl = document.getElementById("settings");
const approvalEl = document.getElementById("approval");
const approvalText = document.getElementById("approvalText");
const cfgBase = document.getElementById("cfgBase");
const cfgKey = document.getElementById("cfgKey");
const cfgModel = document.getElementById("cfgModel");
const cfgHint = document.getElementById("cfgHint");

const hostStatus = document.getElementById("hostStatus");
const versionEl = document.getElementById("version");

/** Idle progress timeout: resets on every event for the active prompt. */
const PROGRESS_IDLE_MS = 90_000;

let port = null;
let attachedTab = null;
let streaming = false;
let promptSeq = 0;
let activePromptId = null;
let currentAgentEl = null;
let pendingApprovalId = null;
let live = false;
let piReady = false;
let helloTimer = null;
let progressWatch = null;

function setHostStatus(text) {
  hostStatus.textContent = text;
}

function showBanner(text, danger = false) {
  banner.textContent = text || "";
  banner.classList.toggle("hidden", !text);
  banner.style.color = danger ? "var(--danger)" : "var(--ink-2)";
}

function setLive(ok) {
  live = Boolean(ok);
  statusDot.classList.toggle("dim", !ok);
}

function fillSettings(llm) {
  if (!llm) return;
  if (llm.baseUrl) cfgBase.value = llm.baseUrl;
  if (llm.modelId) cfgModel.value = llm.modelId;
  cfgKey.value = "";
  if (llm.hasKey) {
    cfgKey.placeholder = `saved ${llm.keyHint} — leave blank to keep`;
    cfgHint.textContent = `Saved in ~/.pandapi (${llm.keyHint}). Leave the key blank to keep using it.`;
  } else {
    cfgKey.placeholder = "sk-…";
    cfgHint.textContent = "No key stored yet.";
  }
}

function armHello() {
  clearTimeout(helloTimer);
  helloTimer = setTimeout(() => {
    if (live) return;
    showBanner("Local host did not answer. Reloading it… run bun run setup-host if this repeats.", true);
    setHostStatus("Host not connected");
    port?.postMessage({ type: "reconnect_host" });
    setTimeout(() => port?.postMessage({ type: "hello" }), 400);
  }, 4000);
}

function clearProgressWatch() {
  clearTimeout(progressWatch);
  progressWatch = null;
}

function bumpProgressWatch() {
  clearProgressWatch();
  if (!streaming || !activePromptId) return;
  progressWatch = setTimeout(() => {
    if (!streaming || !activePromptId) return;
    appendLine(
      "No progress from the host for 90s (slow LLM/page work is OK — this only fires when nothing arrives). Reloading the native host…",
      "error",
    );
    port?.postMessage({ type: "reconnect_host" });
    finishPrompt();
  }, PROGRESS_IDLE_MS);
}

function connect() {
  port = chrome.runtime.connect({ name: "pandapi-panel" });
  port.onMessage.addListener(onHost);
  port.onDisconnect.addListener(() => {
    port = null;
    setLive(false);
    piReady = false;
    setHostStatus("Disconnected");
    showBanner("Disconnected from the extension worker.", true);
    setTimeout(connect, 500);
  });
  port.postMessage({ type: "hello" });
  armHello();
}

function applyHello(msg) {
  clearTimeout(helloTimer);
  setLive(true);
  piReady = Boolean(msg.piReady || msg.model);
  setHostStatus(piReady ? "This window only" : "Host up — add a model in Settings");
  modelEl.replaceChildren();
  for (const m of msg.models || []) {
    const opt = document.createElement("option");
    opt.value = `${m.provider}/${m.id}`;
    opt.textContent = m.name ? `${m.name} (${m.provider})` : `${m.provider}/${m.id}`;
    if (msg.model && m.provider === msg.model.provider && m.id === msg.model.id) opt.selected = true;
    modelEl.appendChild(opt);
  }
  if (!msg.models?.length) {
    const opt = document.createElement("option");
    opt.textContent = "No models — open Settings";
    modelEl.appendChild(opt);
  }
  if (msg.llm) {
    fillSettings(msg.llm);
    chrome.storage.local.set({
      llm: msg.llm,
      models: msg.models || [],
      model: msg.model || null,
    });
  }
  showBanner(msg.warning || "", Boolean(msg.warning));
}

function onHost(msg) {
  if (msg.type === "hello_ok") {
    applyHello(msg);
    return;
  }
  if (msg.type === "hello_error" || msg.type === "host_error") {
    setLive(false);
    piReady = false;
    setHostStatus("Host error");
    showBanner(msg.message, true);
    appendLine(msg.message, "error");
    return;
  }
  if (msg.type === "screenshot" && msg.dataUrl) {
    shot.src = msg.dataUrl;
    shotWrap.classList.remove("hidden");
    return;
  }
  if (msg.type === "approval_request") {
    pendingApprovalId = msg.id;
    approvalText.textContent = msg.summary;
    approvalEl.classList.remove("hidden");
    bumpProgressWatch();
    return;
  }
  if (msg.type === "event") {
    // Only handle events for our active prompt (ignore other panels / stale ids)
    if (activePromptId && msg.id !== activePromptId && msg.id !== "host") return;
    bumpProgressWatch();
    const e = msg.event;
    if (e.type === "text_delta") appendAgent(e.text);
    if (e.type === "tool_start") appendLine(`tool ${e.name}${e.detail ? " " + e.detail : ""}`, "tool");
    if (e.type === "tool_end") appendLine(`done ${e.name}`, "tool");
    if (e.type === "error") appendLine(e.message, "error");
    if (e.type === "done") {
      if (!activePromptId || msg.id === activePromptId || msg.id === "host") finishPrompt();
    }
  }
}

function hideEmpty() {
  emptyEl?.classList.add("hidden");
}

function appendLine(text, cls) {
  hideEmpty();
  const div = document.createElement("div");
  div.className = `msg ${cls}`;
  div.textContent = text;
  logEl.appendChild(div);
  logEl.scrollTop = logEl.scrollHeight;
  return div;
}

function appendAgent(delta) {
  hideEmpty();
  if (!currentAgentEl) currentAgentEl = appendLine("", "agent");
  currentAgentEl.textContent += delta;
  logEl.scrollTop = logEl.scrollHeight;
}

function finishPrompt() {
  streaming = false;
  activePromptId = null;
  currentAgentEl = null;
  sendBtn.disabled = false;
  abortBtn.disabled = true;
  clearProgressWatch();
}

function sendPrompt(text) {
  const trimmed = text.trim();
  if (!trimmed || streaming) return;
  if (!live || !port) {
    appendLine(
      "Local host is not connected (grey dot). In the repo run: bun run setup-host — then on brave://extensions click Reload on PandaPi.",
      "error",
    );
    return;
  }
  if (!piReady) {
    appendLine("No model is loaded. Open Settings, Save (leave the key blank to keep the saved one), and wait until the dropdown shows a model.", "error");
    return;
  }
  streaming = true;
  currentAgentEl = null;
  sendBtn.disabled = true;
  abortBtn.disabled = false;
  appendLine(trimmed, "user");
  input.value = "";
  const id = `p${++promptSeq}-${Date.now()}`;
  activePromptId = id;
  port.postMessage({
    type: "prompt",
    id,
    text: trimmed,
    tab: attachedTab,
  });
  bumpProgressWatch();
}

async function refreshTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) {
    attachedTab = null;
    tabCard.classList.add("hidden");
    return;
  }
  attachedTab = {
    tabId: tab.id,
    windowId: tab.windowId,
    title: tab.title || "",
    url: tab.url || "",
    favIconUrl: tab.favIconUrl,
  };
  tabTitle.textContent = attachedTab.title || "Tab";
  tabUrl.textContent = attachedTab.url.replace(/^https?:\/\//, "");
  tabFav.src = attachedTab.favIconUrl || "icons/icon16.png";
  tabCard.classList.remove("hidden");
}

function answerApproval(allow) {
  if (!pendingApprovalId) return;
  port?.postMessage({ type: "approval_result", id: pendingApprovalId, allow });
  pendingApprovalId = null;
  approvalEl.classList.add("hidden");
  bumpProgressWatch();
}

sendBtn.addEventListener("click", () => sendPrompt(input.value));
input.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter" && !ev.shiftKey) {
    ev.preventDefault();
    sendPrompt(input.value);
  }
});
abortBtn.addEventListener("click", () => port?.postMessage({ type: "abort" }));
document.getElementById("newChat").addEventListener("click", () => {
  port?.postMessage({ type: "new_session" });
  logEl.querySelectorAll(".msg").forEach((n) => n.remove());
  emptyEl.classList.remove("hidden");
  finishPrompt();
});
document.getElementById("detachTab").addEventListener("click", () => {
  attachedTab = null;
  tabCard.classList.add("hidden");
});
document.getElementById("clearShot").addEventListener("click", () => shotWrap.classList.add("hidden"));
document.getElementById("openSettings").addEventListener("click", () => {
  settingsEl.classList.toggle("hidden");
});
document.getElementById("saveSettings").addEventListener("click", () => {
  port?.postMessage({
    type: "set_config",
    baseUrl: cfgBase.value.trim(),
    apiKey: cfgKey.value.trim(),
    modelId: cfgModel.value.trim(),
  });
  cfgKey.value = "";
  settingsEl.classList.add("hidden");
});
document.getElementById("approvalAllow").addEventListener("click", () => answerApproval(true));
document.getElementById("approvalDeny").addEventListener("click", () => answerApproval(false));
modelEl.addEventListener("change", () => {
  const [provider, ...rest] = modelEl.value.split("/");
  const modelId = rest.join("/");
  if (provider && modelId) port?.postMessage({ type: "set_model", provider, modelId });
});
for (const chip of document.querySelectorAll(".chip")) {
  chip.addEventListener("click", () => sendPrompt(chip.dataset.prompt));
}

chrome.tabs.onActivated.addListener(() => refreshTab());
chrome.tabs.onUpdated.addListener((id, info) => {
  if (attachedTab && id === attachedTab.tabId && (info.title || info.url || info.favIconUrl)) {
    refreshTab();
  }
});

chrome.storage.local.get(["llm", "models", "model"], (stored) => {
  if (stored?.llm) fillSettings(stored.llm);
  if (stored?.models?.length) {
    modelEl.replaceChildren();
    for (const m of stored.models) {
      const opt = document.createElement("option");
      opt.value = `${m.provider}/${m.id}`;
      opt.textContent = m.name ? `${m.name} (${m.provider})` : `${m.provider}/${m.id}`;
      if (stored.model && m.provider === stored.model.provider && m.id === stored.model.id) opt.selected = true;
      modelEl.appendChild(opt);
    }
  }
});
try {
  versionEl.textContent = `v${chrome.runtime.getManifest().version}`;
} catch {
  versionEl.textContent = "";
}
connect();
refreshTab();
