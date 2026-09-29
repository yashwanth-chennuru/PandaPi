import { handleBrowserMethod } from "./browser.js";

const HOST = "com.pandapi.host";

let nativePort = null;
/** @type {Map<string, chrome.runtime.Port>} */
const panelsById = new Map();
/** @type {Map<string, string>} promptId → panelId */
const promptOwner = new Map();
/** @type {Map<string, string>} approvalId → panelId */
const approvalOwner = new Map();
let reconnectTimer = null;
let panelSeq = 0;

function sendToPanel(panelId, msg) {
  if (!panelId) return false;
  const port = panelsById.get(panelId);
  if (!port) return false;
  try {
    port.postMessage(msg);
    return true;
  } catch {
    panelsById.delete(panelId);
    return false;
  }
}

function broadcast(msg) {
  for (const [id, port] of panelsById) {
    try {
      port.postMessage(msg);
    } catch {
      panelsById.delete(id);
    }
  }
}

function routeHostMessage(msg) {
  if (msg?.type === "browser_request") {
    return false; // handled separately
  }
  if (msg?.type === "event" && msg.id) {
    const owner = msg.panelId || promptOwner.get(msg.id);
    if (owner && sendToPanel(owner, msg)) {
      if (msg.event?.type === "done") promptOwner.delete(msg.id);
      return true;
    }
  }
  if (msg?.type === "approval_request") {
    const owner = msg.panelId;
    if (owner) {
      approvalOwner.set(msg.id, owner);
      if (sendToPanel(owner, msg)) return true;
    }
  }
  if (msg?.type === "approval_resolved") {
    approvalOwner.delete(msg.id);
    if (msg.panelId && sendToPanel(msg.panelId, msg)) return true;
  }
  if (msg?.type === "hello_ok" || msg?.type === "hello_error") {
    if (msg.panelId && sendToPanel(msg.panelId, msg)) return true;
    broadcast(msg);
    return true;
  }
  if (msg?.panelId && sendToPanel(msg.panelId, msg)) return true;
  return false;
}

function attachNativeListeners(port) {
  port.onMessage.addListener(async (msg) => {
    if (msg?.type === "browser_request") {
      const panelId = msg.panelId;
      try {
        const result = await handleBrowserMethod(msg.method, msg.params || {});
        nativePort?.postMessage({ type: "browser_result", id: msg.id, ok: true, result, panelId });
        if (msg.method === "screenshot" && result?.dataUrl) {
          const shot = { type: "screenshot", dataUrl: result.dataUrl, panelId };
          if (!panelId || !sendToPanel(panelId, shot)) broadcast(shot);
        }
      } catch (err) {
        nativePort?.postMessage({
          type: "browser_result",
          id: msg.id,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
          panelId,
        });
      }
      return;
    }
    if (!routeHostMessage(msg)) {
      // Fallback: only broadcast connection-level errors, not agent events
      if (msg?.type === "hello_ok" || msg?.type === "hello_error" || msg?.type === "host_error") {
        broadcast(msg);
      }
    }
  });
  port.onDisconnect.addListener(() => {
    const err = chrome.runtime.lastError?.message;
    nativePort = null;
    broadcast({
      type: "host_error",
      message: err
        ? `Native host disconnected: ${err}. Run bun run setup-host, then reload this unpacked extension.`
        : "Native host disconnected. Reload the extension or run bun run setup-host.",
    });
    if (panelsById.size && !reconnectTimer) {
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connectNative(true);
      }, 750);
    }
  });
}

function connectNative(force = false) {
  if (nativePort && !force) {
    try {
      nativePort.postMessage({ type: "hello" });
      return nativePort;
    } catch {
      nativePort = null;
    }
  }
  if (force && nativePort) {
    try {
      nativePort.disconnect();
    } catch {
      /* already gone */
    }
    nativePort = null;
  }
  try {
    nativePort = chrome.runtime.connectNative(HOST);
  } catch (err) {
    broadcast({ type: "host_error", message: String(err) });
    return null;
  }
  attachNativeListeners(nativePort);
  try {
    nativePort.postMessage({ type: "hello" });
  } catch (err) {
    broadcast({
      type: "host_error",
      message: `Could not talk to native host: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
  return nativePort;
}

chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => {});

chrome.action.onClicked.addListener(async (tab) => {
  if (tab?.windowId != null && chrome.sidePanel?.open) {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  }
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "pandapi-panel") return;
  const panelId = `panel-${++panelSeq}-${Date.now()}`;
  port._pandapiPanelId = panelId;
  panelsById.set(panelId, port);
  connectNative();
  port.onMessage.addListener((msg) => {
    if (msg?.type === "reconnect_host") {
      connectNative(true);
      return;
    }
    if (!nativePort) connectNative();
    if (!nativePort) {
      port.postMessage({
        type: "host_error",
        message: "Could not start native host. Run bun run setup-host, then reload the unpacked extension.",
      });
      return;
    }
    const outbound = { ...msg, panelId };
    if (msg?.type === "prompt" && msg.id) {
      promptOwner.set(msg.id, panelId);
    }
    if (msg?.type === "approval_result" && msg.id) {
      // only accept from owning panel
      const owner = approvalOwner.get(msg.id);
      if (owner && owner !== panelId) {
        port.postMessage({
          type: "host_error",
          message: "This approval belongs to another panel.",
        });
        return;
      }
      approvalOwner.delete(msg.id);
    }
    try {
      nativePort.postMessage(outbound);
    } catch {
      connectNative(true);
      try {
        nativePort?.postMessage(outbound);
      } catch (err) {
        port.postMessage({
          type: "host_error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  });
  port.onDisconnect.addListener(() => {
    panelsById.delete(panelId);
    for (const [pid, owner] of promptOwner) {
      if (owner === panelId) promptOwner.delete(pid);
    }
    for (const [aid, owner] of approvalOwner) {
      if (owner === panelId) approvalOwner.delete(aid);
    }
  });
});
