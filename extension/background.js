import { handleBrowserMethod } from "./browser.js";

const HOST = "com.pandapi.host";

let nativePort = null;
const panelPorts = new Set();
let reconnectTimer = null;

function broadcast(msg) {
  for (const p of panelPorts) {
    try {
      p.postMessage(msg);
    } catch {
      panelPorts.delete(p);
    }
  }
}

function attachNativeListeners(port) {
  port.onMessage.addListener(async (msg) => {
    if (msg?.type === "browser_request") {
      try {
        const result = await handleBrowserMethod(msg.method, msg.params || {});
        nativePort?.postMessage({ type: "browser_result", id: msg.id, ok: true, result });
        if (msg.method === "screenshot" && result?.dataUrl) {
          broadcast({ type: "screenshot", dataUrl: result.dataUrl });
        }
      } catch (err) {
        nativePort?.postMessage({
          type: "browser_result",
          id: msg.id,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return;
    }
    broadcast(msg);
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
    if (panelPorts.size && !reconnectTimer) {
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
  panelPorts.add(port);
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
    try {
      nativePort.postMessage(msg);
    } catch {
      connectNative(true);
      try {
        nativePort?.postMessage(msg);
      } catch (err) {
        port.postMessage({
          type: "host_error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  });
  port.onDisconnect.addListener(() => panelPorts.delete(port));
});
