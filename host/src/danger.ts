/**
 * Approval heuristics. A control needs approval when it can submit, send, pay,
 * delete, publish, or move money/keys — regardless of whether its label is in
 * English, and regardless of whether it carries a label at all.
 */

const DANGEROUS_LABEL_SOURCES = [
  // submit / commit
  "send|sent|sending|submit|submitted|confirm|continue|approve|accept|yes|ok|okay",
  // money
  "pay|payment|purchase|buy|order|checkout|transfer|wire|deposit|withdraw|swap|place\\s+bid|make\\s+offer",
  // destructive
  "delete|remove|destroy|erase|revoke|close\\s+account|unsubscribe|cancel\\s+subscription",
  // permissions
  "grant|allow|enable\\s+access",
  // publishing (public and hard to take back)
  "post|publish|tweet|reply|comment|share|save\\s+changes",
  // wallets / signatures
  "mint|stake|unstake|claim|airdrop|connect\\s+wallet|sign\\s+(transaction|message|order)",
  // explicit phrases
  "place\\s+order|complete\\s+purchase|confirm\\s+payment|send\\s+(now|email|message)|pay\\s+now|buy\\s+now",
];

const DANGEROUS_LABEL = new RegExp(`\\b(?:${DANGEROUS_LABEL_SOURCES.join("|")})\\b`, "i");

/** Links whose destination is itself an action endpoint. */
const DANGEROUS_HREF =
  /(?:mailto:|tel:|\/(?:checkout|delete|remove|send|pay|order|unsubscribe|cancel|signout|logout|purchase|buy)\b)/i;

const SUBMIT_KEYS = new Set(["enter", "return"]);

export function isDangerousLabel(label: string): boolean {
  const t = label.toLowerCase().replace(/\s+/g, " ").trim();
  if (!t) return false;
  return DANGEROUS_LABEL.test(t);
}

export function isDangerousHref(href: string): boolean {
  return DANGEROUS_HREF.test(href);
}

export function isSubmitKey(key: string): boolean {
  return SUBMIT_KEYS.has(key.toLowerCase().trim());
}

export type ApprovalOptions = {
  pressEnter?: boolean;
  key?: string;
  tag?: string;
  type?: string;
  href?: string;
};

/**
 * Decide whether an action needs explicit approval.
 *
 * `label` is the live control name when available; `opts.tag/type/href` come
 * from the live DOM so icon-only or non-English controls are still gated.
 */
export function needsApproval(action: string, label?: string, opts?: ApprovalOptions): boolean {
  if (action === "compose_gmail") return false;
  if (action === "type_text" && opts?.pressEnter) {
    // Enter can submit unknown forms — always gate.
    return true;
  }
  if (action === "press_key" && opts?.key && isSubmitKey(opts.key)) {
    return true;
  }
  // Submit-type controls are gated even when they have no usable label.
  if (opts?.type && opts.type.toLowerCase() === "submit") return true;
  if (opts?.href && isDangerousHref(opts.href)) return true;
  if (label && isDangerousLabel(label)) return true;
  return false;
}
