export function isDangerousLabel(label: string): boolean {
  const t = label.toLowerCase().replace(/\s+/g, " ").trim();
  if (!t) return false;
  return (
    /\b(send|send now|send email|send message)\b/.test(t) ||
    /\b(pay|payment|pay now|purchase|buy now|place order|checkout|confirm payment)\b/.test(t) ||
    /\b(delete|remove account|close account|transfer|wire|grant access|allow all)\b/.test(t) ||
    /\b(submit payment|complete purchase)\b/.test(t)
  );
}

export function needsApproval(action: string, label?: string): boolean {
  if (action === "compose_gmail") return false;
  if (label && isDangerousLabel(label)) return true;
  return false;
}
