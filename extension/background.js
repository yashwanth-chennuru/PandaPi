import { handleBrowserMethod } from "./browser.js";

const HOST = "com.pandapi.host";

let nativePort = null;
const panelPorts = new Set();

function broadcast(msg) {
  for (const p of panelPorts) {
    try {
      p.postMessage(msg);
    } catch {
      panelPorts.delete(p);
    }
  }
}

function connectNative() {
  if (nativePort) return nativePort;
  try {
    nativePort = chrome.runtime.connectNative(HOST);
  } catch (err) {
    broadcast({ type: "host_error", message: String(err) });
    return null;
  }
  nativePort.onMessage.addListener(async (msg) => {
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
  nativePort.onDisconnect.addListener(() => {
    const err = chrome.runtime.lastError?.message;
    nativePort = null;
    broadcast({
      type: "host_error",
      message: err
        ? `Native host disconnected: ${err}. Run bun run setup-host in the PandaPi repo.`
        : "Native host disconnected.",
    });
  });
  nativePort.postMessage({ type: "hello" });
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
    if (!nativePort) connectNative();
    if (!nativePort) {
      port.postMessage({
        type: "host_error",
        message: "Could not start native host. Run bun run setup-host.",
      });
      return;
    }
    nativePort.postMessage(msg);
  });
  port.onDisconnect.addListener(() => panelPorts.delete(port));
});
