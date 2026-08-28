import { clickRef, pressKey, scrollPage, snapshotPage, typeRef } from "./page-actions.js";

async function inject(tabId, func, args = []) {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func,
      args,
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
    chrome.tabs.get(tabId).then((tab) => {
      if (tab.status === "complete") finish(tab);
    }).catch(() => {});
    setTimeout(async () => {
      try {
        finish(await chrome.tabs.get(tabId));
      } catch {
        finish({ id: tabId });
      }
    }, timeoutMs);
  });
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
      const tab = await chrome.tabs.get(tabId);
      await chrome.tabs.update(tabId, { active: true });
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
      return {
        mimeType: "image/png",
        dataUrl,
        note: "Screenshot captured. Shown in the PandaPi side panel. Not written to disk. Snapshots still go to your LLM provider.",
      };
    }
    case "snapshot": {
      return inject(tabId, snapshotPage);
    }
    case "click": {
      return inject(tabId, clickRef, [params.ref]);
    }
    case "type_text": {
      return inject(tabId, typeRef, [params.ref, params.text, Boolean(params.pressEnter)]);
    }
    case "press_key": {
      return inject(tabId, pressKey, [params.key]);
    }
    case "scroll": {
      return inject(tabId, scrollPage, [params.direction || "down"]);
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
