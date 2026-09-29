/**
 * Page functions injected via chrome.scripting.executeScript.
 * Each exported function MUST be self-contained: Chrome serializes only the
 * function body, so helpers must live inside the function (not module scope).
 */

export function runPageAction(action, arg1, arg2, arg3) {
  // Refs live in this isolated world's global rather than in DOM attributes,
  // so page scripts cannot read, move, or forge them. The isolated world's
  // globalThis persists across executeScript calls until navigation.
  const REF_STORE = "__pandapiRefsV1";

  function refMap() {
    const g = globalThis;
    if (!(g[REF_STORE] instanceof Map)) g[REF_STORE] = new Map();
    return g[REF_STORE];
  }

  function clearRefs() {
    refMap().clear();
  }

  function walkRoots(visit) {
    visit(document);
    try {
      for (const frame of document.querySelectorAll("iframe")) {
        try {
          const doc = frame.contentDocument;
          if (doc) visit(doc);
        } catch {
          /* cross-origin */
        }
      }
    } catch {
      /* ignore */
    }
  }

  function findRef(ref) {
    const map = refMap();
    const el = map.get(ref);
    if (!el) return null;
    if (!el.isConnected) {
      map.delete(ref);
      return null;
    }
    return el;
  }

  function visibleText(root, limit) {
    const parts = [];
    let total = 0;
    const skip = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "SVG", "PATH"]);
    const walk = (node) => {
      if (!node || total >= limit) return;
      if (node.nodeType === Node.TEXT_NODE) {
        const t = (node.textContent || "").replace(/\s+/g, " ").trim();
        if (t) {
          parts.push(t);
          total += t.length + 1;
        }
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const el = node;
      if (skip.has(el.tagName)) return;
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") return;
      if (el.getAttribute("aria-hidden") === "true") return;
      for (const child of el.childNodes) walk(child);
    };
    walk(root.body || root);
    return parts.join(" ").slice(0, limit);
  }

  function snapshot() {
    const interactive = [
      "a[href]",
      "button",
      "input",
      "textarea",
      "select",
      "[contenteditable='true']",
      "[role='button']",
      "[role='link']",
      "[role='tab']",
      "[role='menuitem']",
      "[role='checkbox']",
      "[role='textbox']",
      "[role='combobox']",
      "[role='option']",
      "[role='switch']",
      "summary",
    ].join(",");

    walkRoots(clearRefs);

    const seen = new Set();
    const items = [];
    const refs = refMap();
    let i = 0;

    const visit = (root) => {
      if (!root) return;
      try {
        for (const el of root.querySelectorAll(interactive)) {
          if (seen.has(el)) continue;
          seen.add(el);
          const style = window.getComputedStyle(el);
          if (style.display === "none" || style.visibility === "hidden") continue;
          const rect = el.getBoundingClientRect();
          if (rect.width < 2 && rect.height < 2) continue;

          i += 1;
          const ref = `e${i}`;
          refs.set(ref, el);
          const tag = el.tagName.toLowerCase();
          const role = el.getAttribute("role") || tag;
          const type = (el.getAttribute("type") || "").toLowerCase();
          let name =
            el.getAttribute("aria-label") ||
            el.getAttribute("placeholder") ||
            el.getAttribute("name") ||
            el.getAttribute("title") ||
            el.getAttribute("value") ||
            (el.innerText || "").trim().replace(/\s+/g, " ").slice(0, 80);
          if (el.id) {
            try {
              const lab = root.querySelector?.(`label[for="${CSS.escape(el.id)}"]`);
              if (lab && !name) name = (lab.innerText || "").trim().slice(0, 80);
            } catch {
              /* ignore */
            }
          }
          const disabled = Boolean(el.disabled) || el.getAttribute("aria-disabled") === "true";
          items.push({
            ref,
            role,
            type: type || undefined,
            name: name || undefined,
            href: el.getAttribute("href") || undefined,
            disabled: disabled || undefined,
          });
        }
        root.querySelectorAll("*").forEach((el) => {
          if (el.shadowRoot) visit(el.shadowRoot);
        });
      } catch {
        /* closed shadow */
      }
    };

    walkRoots(visit);

    const title = document.title;
    const url = location.href;
    const generation = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const pageText = visibleText(document, 6000);
    const lines = [`${title} — ${url}`, ""];
    if (pageText) {
      lines.push("Page text:");
      lines.push(pageText);
      lines.push("");
    }
    lines.push("Interactive:");
    const shown = items.slice(0, 220);
    for (const it of shown) {
      const bits = [`[${it.ref}]`, it.role];
      if (it.type) bits.push(it.type);
      if (it.disabled) bits.push("disabled");
      if (it.name) bits.push(`"${it.name}"`);
      if (it.href) bits.push(it.href);
      lines.push(bits.join(" "));
    }
    if (items.length > shown.length) lines.push(`… ${items.length - shown.length} more truncated`);
    return {
      title,
      url,
      generation,
      count: items.length,
      items: shown,
      text: lines.join("\n"),
    };
  }

  function click(ref) {
    const el = findRef(ref);
    if (!el) return { ok: false, error: `No element ${ref}. Take a new snapshot.` };
    el.scrollIntoView({ block: "center", inline: "nearest" });
    el.focus();
    el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
    el.click();
    return {
      ok: true,
      ref,
      tag: el.tagName.toLowerCase(),
      name: (el.getAttribute("aria-label") || el.innerText || "").trim().slice(0, 80),
      url: location.href,
    };
  }

  function typeInto(ref, text, pressEnter) {
    const el = findRef(ref);
    if (!el) return { ok: false, error: `No element ${ref}. Take a new snapshot.` };
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute("type") || "").toLowerCase();
    if (type === "password") {
      return { ok: false, error: "Refused to type into a password field. Ask the user to log in." };
    }
    if (tag === "select" || tag === "button" || type === "checkbox" || type === "radio" || type === "file" || type === "submit" || type === "button") {
      return {
        ok: false,
        error: `Cannot type into <${tag}${type ? ` type=${type}` : ""}>. Use click or a different ref.`,
      };
    }
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el.isContentEditable)) {
      return { ok: false, error: `Element ${ref} is not a text input.` };
    }
    el.scrollIntoView({ block: "center", inline: "nearest" });
    el.focus();
    const proto =
      el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : el instanceof HTMLInputElement
          ? HTMLInputElement.prototype
          : null;
    const setter = proto ? Object.getOwnPropertyDescriptor(proto, "value")?.set : undefined;
    if (setter && "value" in el) setter.call(el, text);
    else if (el.isContentEditable) el.textContent = text;
    el.dispatchEvent(new InputEvent("input", { bubbles: true, data: text, inputType: "insertText" }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    let submitted = false;
    if (pressEnter) {
      const form = el.form || el.closest?.("form");
      if (form && typeof form.requestSubmit === "function") {
        try {
          form.requestSubmit();
          submitted = true;
        } catch {
          /* fall through */
        }
      }
      if (!submitted) {
        el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }));
        el.dispatchEvent(new KeyboardEvent("keypress", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }));
        el.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }));
      }
    }
    return { ok: true, ref, submitted, url: location.href };
  }

  function press(key) {
    const target = document.activeElement || document.body;
    if ((key === "Enter" || key === "Return") && target && "form" in target && target.form) {
      try {
        target.form.requestSubmit();
        return { ok: true, key, submitted: true, url: location.href };
      } catch {
        /* fall through */
      }
    }
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    target.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true, cancelable: true }));
    return { ok: true, key, url: location.href };
  }

  function scroll(direction) {
    const d = String(direction || "down").toLowerCase();
    if (d === "top") window.scrollTo({ top: 0, behavior: "instant" });
    else if (d === "bottom") window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" });
    else if (d === "up") window.scrollBy({ top: -Math.round(window.innerHeight * 0.85), behavior: "instant" });
    else window.scrollBy({ top: Math.round(window.innerHeight * 0.85), behavior: "instant" });
    return { ok: true, direction: d, y: window.scrollY, url: location.href };
  }

  function describe(ref) {
    const el = findRef(ref);
    if (!el) return { ok: false, error: `No element ${ref}.` };
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute("type") || "").toLowerCase();
    const name =
      el.getAttribute("aria-label") ||
      el.getAttribute("placeholder") ||
      el.getAttribute("name") ||
      el.getAttribute("title") ||
      el.getAttribute("value") ||
      (el.innerText || "").trim().replace(/\s+/g, " ").slice(0, 120);
    return {
      ok: true,
      ref,
      tag,
      type: type || undefined,
      name: name || undefined,
      href: el.getAttribute("href") || undefined,
      url: location.href,
    };
  }

  switch (action) {
    case "snapshot":
      return snapshot();
    case "click":
      return click(arg1);
    case "type":
      return typeInto(arg1, arg2, Boolean(arg3));
    case "press":
      return press(arg1);
    case "scroll":
      return scroll(arg1);
    case "describe":
      return describe(arg1);
    default:
      return { ok: false, error: `Unknown page action ${action}` };
  }
}
