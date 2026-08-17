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
  ].join(",");

  const seen = new Set();
  const items = [];
  let i = 0;

  const all = [];
  const visit = (root) => {
    if (!root) return;
    try {
      all.push(...root.querySelectorAll(interactive));
      root.querySelectorAll("*").forEach((el) => {
        if (el.shadowRoot) visit(el.shadowRoot);
      });
    } catch {
      /* closed shadow */
    }
  };
  visit(document);

  for (const el of all) {
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
    const type = el.getAttribute("type") || "";
    const name =
      el.getAttribute("aria-label") ||
      el.getAttribute("placeholder") ||
      el.getAttribute("name") ||
      el.getAttribute("title") ||
      (el.innerText || "").trim().replace(/\s+/g, " ").slice(0, 80);
    items.push({
      ref,
      role,
      type,
      name,
      href: el.getAttribute("href") || undefined,
    });
  }

  const title = document.title;
  const url = location.href;
  const lines = [`${title} — ${url}`, ""];
  for (const it of items.slice(0, 250)) {
    lines.push(`[${it.ref}] ${it.role}${it.type ? " " + it.type : ""}${it.name ? ': "' + it.name + '"' : ""}${it.href ? " " + it.href : ""}`);
  }
  if (items.length > 250) lines.push(`… ${items.length - 250} more truncated`);
  return { title, url, count: items.length, text: lines.join("\n") };
}

export function clickRef(ref) {
  const el = document.querySelector(`[data-pandapi-ref="${CSS.escape(ref)}"]`);
  if (!el) return { ok: false, error: `No element ${ref}. Take a new snapshot.` };
  el.scrollIntoView({ block: "center", inline: "nearest" });
  el.click();
  return { ok: true, ref, tag: el.tagName.toLowerCase() };
}

export function typeRef(ref, text, pressEnter) {
  const el = document.querySelector(`[data-pandapi-ref="${CSS.escape(ref)}"]`);
  if (!el) return { ok: false, error: `No element ${ref}. Take a new snapshot.` };
  el.scrollIntoView({ block: "center", inline: "nearest" });
  el.focus();
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
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
