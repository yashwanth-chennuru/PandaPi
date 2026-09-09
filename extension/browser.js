import { runPageAction } from "./page-actions.js";

async function inject(tabId, action, args = []) {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "ISOLATED",
      func: runPageAction,
      args: [action, ...args],
    });
    if (result?.error) throw new Error(String(result.error));
    return result?.result;
  } catch (err) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    const url = tab?.url || `tab ${tabId}`;
    throw new Error(`Cannot script ${url}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function tabInfo(tab) {
  return {
    tabId: tab.id,
    windowId: tab.windowId,
    title: tab.title || "",
    url: tab.url || "",
    favIconUrl: tab.favIconUrl,
    active: tab.active,
  };
}

function waitTabComplete(tabId, timeoutMs = 20000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (tab) => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve(tab);
    };
    const onUpdated = (id, info, tab) => {
      if (id === tabId && info.status === "complete") finish(tab);
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs
      .get(tabId)
      .then((tab) => {
        if (tab.status === "complete") finish(tab);
      })
      .catch(() => {});
    setTimeout(async () => {
      try {
        finish(await chrome.tabs.get(tabId));
      } catch {
        finish({ id: tabId });
      }
    }, timeoutMs);
  });
}

async function withFocusRestored(tabId, fn) {
  const target = await chrome.tabs.get(tabId);
  const [prev] = await chrome.tabs.query({ active: true, windowId: target.windowId });
  const prevId = prev?.id;
  if (prevId !== tabId) {
    await chrome.tabs.update(tabId, { active: true });
  }
  try {
    return await fn(target);
  } finally {
    if (prevId && prevId !== tabId) {
      await chrome.tabs.update(prevId, { active: true }).catch(() => {});
    }
  }
}

export async function handleBrowserMethod(method, params) {
  const tabId = params.tabId;

  switch (method) {
    case "tabs_list": {
      const windowId = params.windowId;
      const tabs = windowId
        ? await chrome.tabs.query({ windowId })
        : await chrome.tabs.query({ currentWindow: true });
      return tabs.filter((t) => t.id != null).map(tabInfo);
    }
    case "tabs_create": {
      const tab = await chrome.tabs.create({
        url: params.url || "chrome://newtab/",
        active: params.active !== false,
      });
      if (tab.id && params.url) await waitTabComplete(tab.id);
      return tabInfo(await chrome.tabs.get(tab.id));
    }
    case "tabs_activate": {
      const tab = await chrome.tabs.get(tabId);
      await chrome.windows.update(tab.windowId, { focused: true });
      await chrome.tabs.update(tabId, { active: true });
      return tabInfo(await chrome.tabs.get(tabId));
    }
    case "navigate": {
      await chrome.tabs.update(tabId, { url: params.url });
      const tab = await waitTabComplete(tabId);
      return tabInfo(tab);
    }
    case "screenshot": {
      return withFocusRestored(tabId, async (tab) => {
        const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
        return {
          mimeType: "image/png",
          dataUrl,
          tabId,
          url: tab.url || "",
          note: "Screenshot captured. Image bytes are returned to the model. Also shown in the side panel. Not written to disk.",
        };
      });
    }
    case "snapshot": {
      const tab = await chrome.tabs.get(tabId);
      const snap = await inject(tabId, "snapshot");
      return {
        ...snap,
        tabId,
        url: tab.url || snap?.url || "",
      };
    }
    case "click": {
      return inject(tabId, "click", [params.ref]);
    }
    case "type_text": {
      return inject(tabId, "type", [params.ref, params.text, Boolean(params.pressEnter)]);
    }
    case "press_key": {
      return inject(tabId, "press", [params.key]);
    }
    case "scroll": {
      return inject(tabId, "scroll", [params.direction || "down"]);
    }
    case "describe": {
      return inject(tabId, "describe", [params.ref]);
    }
    case "wait": {
      const ms = Math.min(Math.max(Number(params.ms) || 1200, 0), 15_000);
      await new Promise((r) => setTimeout(r, ms));
      return { ok: true, ms };
    }
    case "compose_gmail": {
      const tab = await chrome.tabs.create({ url: params.url, active: true });
      return {
        ...tabInfo(tab),
        note: "Opened Gmail compose as a draft. Do not send. If a screenshot was taken, it is in the side panel to paste or attach.",
      };
    }
    default:
      throw new Error(`Unknown browser method ${method}`);
  }
}
