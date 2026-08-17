import { clickRef, pressKey, snapshotPage, typeRef } from "./page-actions.js";

async function inject(tabId, func, args = []) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func,
    args,
  });
  if (result?.error) throw new Error(String(result.error));
  return result?.result;
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
      return tabInfo(tab);
    }
    case "tabs_activate": {
      const tab = await chrome.tabs.get(tabId);
      await chrome.windows.update(tab.windowId, { focused: true });
      await chrome.tabs.update(tabId, { active: true });
      return tabInfo(await chrome.tabs.get(tabId));
    }
    case "navigate": {
      const tab = await chrome.tabs.update(tabId, { url: params.url });
      return tabInfo(tab);
    }
    case "screenshot": {
      const tab = await chrome.tabs.get(tabId);
      await chrome.tabs.update(tabId, { active: true });
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
      return {
        mimeType: "image/png",
        dataUrl,
        note: "Screenshot captured. Shown in the PandaPi side panel. Not written to disk.",
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
    case "compose_gmail": {
      const tab = await chrome.tabs.create({ url: params.url, active: true });
      return {
        ...tabInfo(tab),
        note: "Opened Gmail compose as a draft. Do not send. If a screenshot was taken, it is in the side panel for the user to paste or attach.",
      };
    }
    default:
      throw new Error(`Unknown browser method ${method}`);
  }
}
