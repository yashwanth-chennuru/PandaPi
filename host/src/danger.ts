const DANGEROUS =
  /\b(send|sent|sending|submit|submitted|confirm|continue|approve|accept|yes|ok|okay|pay|payment|purchase|buy|order|checkout|delete|remove|destroy|erase|transfer|wire|revoke|grant|allow|enable\s+access|close\s+account|unsubscribe|cancel\s+subscription|place\s+order|complete\s+purchase|confirm\s+payment|send\s+(now|email|message)|pay\s+now|buy\s+now)\b/i;

const SUBMIT_KEYS = new Set(["enter", "return"]);

export function isDangerousLabel(label: string): boolean {
  const t = label.toLowerCase().replace(/\s+/g, " ").trim();
  if (!t) return false;
  return DANGEROUS.test(t);
}

export function isSubmitKey(key: string): boolean {
  return SUBMIT_KEYS.has(key.toLowerCase().trim());
}

/**
 * Approve before any action that may submit, send, pay, delete, grant, or navigate away.
 * Action is the tool name; label is the live control name when available.
 */
export function needsApproval(action: string, label?: string, opts?: { pressEnter?: boolean; key?: string }): boolean {
  if (action === "compose_gmail") return false;
  if (action === "type_text" && opts?.pressEnter) {
    // Enter can submit unknown forms — always gate
    return true;
  }
  if (action === "press_key" && opts?.key && isSubmitKey(opts.key)) {
    return true;
  }
  if (label && isDangerousLabel(label)) return true;
  return false;
}
