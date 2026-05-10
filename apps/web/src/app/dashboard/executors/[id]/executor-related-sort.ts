/** ENTER first, EXIT second, other intents last (tie-breaker after primary sort). */
export function intentSortGroup(intent: string): number {
  if (intent === "ENTER") return 0;
  if (intent === "EXIT") return 1;
  return 2;
}

/** Primary: close_time desc. Secondary: ENTER, EXIT, then other intents. */
export function compareSignalsByCloseTimeThenIntent(
  a: { close_time: string; intent: string },
  b: { close_time: string; intent: string },
): number {
  const t = Date.parse(b.close_time) - Date.parse(a.close_time);
  if (t !== 0) return t;
  return intentSortGroup(a.intent) - intentSortGroup(b.intent);
}

/** Primary: close_time desc. Secondary: approved rows first. */
export function compareTradeDecisionsByCloseThenApproved(
  a: { close_time: string; approved: boolean; created_at: string },
  b: { close_time: string; approved: boolean; created_at: string },
): number {
  const t = Date.parse(b.close_time) - Date.parse(a.close_time);
  if (t !== 0) return t;
  if (a.approved !== b.approved) return a.approved ? -1 : 1;
  return Date.parse(b.created_at) - Date.parse(a.created_at);
}
