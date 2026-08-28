/** Page functions injected via chrome.scripting.executeScript. Must stay self-contained. */

export function snapshotPage() {
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

  const seen = new Set();
  const items = [];
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
        el.setAttribute("data-pandapi-ref", ref);
        const tag = el.tagName.toLowerCase();
        const role = el.getAttribute("role") || tag;
        const type = (el.getAttribute("type") || "").toLowerCase();
        let name =
          el.getAttribute("aria-label") ||
          el.getAttribute("placeholder") ||
          el.getAttribute("name") ||
          el.getAttribute("title") ||
          (el.innerText || "").trim().replace(/\s+/g, " ").slice(0, 80);
        if (el.id) {
          const lab = root.querySelector?.(`label[for="${CSS.escape(el.id)}"]`);
          if (lab && !name) name = (lab.innerText || "").trim().slice(0, 80);
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

  visit(document);
  try {
    for (const frame of document.querySelectorAll("iframe")) {
      const doc = frame.contentDocument;
      if (doc) visit(doc);
    }
  } catch {
    /* cross-origin */
  }

  const title = document.title;
  const url = location.href;
  const lines = [`${title} — ${url}`, ""];
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
  return { title, url, count: items.length, items: shown, text: lines.join("\n") };
}

function findRef(ref) {
  const sel = `[data-pandapi-ref="${CSS.escape(ref)}"]`;
  return document.querySelector(sel);
}

export function clickRef(ref) {
  const el = findRef(ref);
  if (!el) return { ok: false, error: `No element ${ref}. Take a new snapshot.` };
  el.scrollIntoView({ block: "center", inline: "nearest" });
  el.click();
  return { ok: true, ref, tag: el.tagName.toLowerCase(), name: (el.getAttribute("aria-label") || el.innerText || "").trim().slice(0, 80) };
}

export function typeRef(ref, text, pressEnter) {
  const el = findRef(ref);
  if (!el) return { ok: false, error: `No element ${ref}. Take a new snapshot.` };
  const type = (el.getAttribute("type") || "").toLowerCase();
  if (type === "password") return { ok: false, error: "Refused to type into a password field. Ask the user to log in." };
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
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  if (pressEnter) {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
    el.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", bubbles: true }));
  }
  return { ok: true, ref };
}

export function pressKey(key) {
  const target = document.activeElement || document.body;
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  target.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true }));
  return { ok: true, key };
}

export function scrollPage(direction) {
  const d = String(direction || "down").toLowerCase();
  if (d === "top") window.scrollTo({ top: 0, behavior: "instant" });
  else if (d === "bottom") window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" });
  else if (d === "up") window.scrollBy({ top: -Math.round(window.innerHeight * 0.85), behavior: "instant" });
  else window.scrollBy({ top: Math.round(window.innerHeight * 0.85), behavior: "instant" });
  return { ok: true, direction: d, y: window.scrollY };
}

