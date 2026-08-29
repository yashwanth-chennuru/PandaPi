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

let port = null;
let attachedTab = null;
let streaming = false;
let promptId = 0;
let currentAgentEl = null;
let pendingApprovalId = null;

function showBanner(text, danger = false) {
  banner.textContent = text || "";
  banner.classList.toggle("hidden", !text);
  banner.style.color = danger ? "#ff6b6b" : "#ffd37a";
}

function setLive(ok) {
  statusDot.classList.toggle("dim", !ok);
}

function connect() {
  port = chrome.runtime.connect({ name: "pandapi-panel" });
  port.onMessage.addListener(onHost);
  port.onDisconnect.addListener(() => {
    port = null;
    setLive(false);
    showBanner("Disconnected from the extension worker.", true);
    setTimeout(connect, 500);
  });
}

function applyHello(msg) {
  setLive(true);
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
    cfgBase.value = msg.llm.baseUrl || "";
    cfgModel.value = msg.llm.modelId || "";
    cfgKey.placeholder = msg.llm.hasKey ? `saved ${msg.llm.keyHint}` : "sk-…";
    cfgHint.textContent = msg.llm.hasKey ? `Key on disk: ${msg.llm.keyHint}` : "No key stored yet.";
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
    showBanner(msg.message, true);
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
    return;
  }
  if (msg.type === "event") {
    const e = msg.event;
    if (e.type === "text_delta") appendAgent(e.text);
    if (e.type === "tool_start") appendLine(`tool ${e.name}${e.detail ? " " + e.detail : ""}`, "tool");
    if (e.type === "tool_end") appendLine(`done ${e.name}`, "tool");
    if (e.type === "error") appendLine(e.message, "error");
    if (e.type === "done") finishPrompt();
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
  currentAgentEl = null;
  sendBtn.disabled = false;
  abortBtn.disabled = true;
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

function sendPrompt(text) {
  const trimmed = text.trim();
  if (!trimmed || streaming) return;
  streaming = true;
  currentAgentEl = null;
  sendBtn.disabled = true;
  abortBtn.disabled = false;
  appendLine(trimmed, "user");
  input.value = "";
  port?.postMessage({
    type: "prompt",
    id: `p${++promptId}`,
    text: trimmed,
    tab: attachedTab,
  });
}

function answerApproval(allow) {
  if (!pendingApprovalId) return;
  port?.postMessage({ type: "approval_result", id: pendingApprovalId, allow });
  pendingApprovalId = null;
  approvalEl.classList.add("hidden");
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

connect();
refreshTab();
