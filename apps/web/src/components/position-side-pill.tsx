/**
 * Compact pill showing whether a row is long or short, mirroring trading.position_side.
 *
 * Used on positions / orders / decisions lists and detail pages so users can
 * scan at a glance which side a row is for. Long is emerald (matches the buy
 * pill), short is amber (margin-leaning palette, distinct from the red sell pill).
 */
export function PositionSidePill({ side }: { side: string | null | undefined }) {
  const normalised = String(side ?? "").trim().toLowerCase();
  const base =
    "inline-flex shrink-0 rounded-full px-2 py-0.5 text-[0.6875rem] font-medium tabular-nums uppercase";
  if (normalised === "long") {
    return <span className={`${base} bg-emerald-500/15 text-emerald-800 dark:text-emerald-300`}>Long</span>;
  }
  if (normalised === "short") {
    return <span className={`${base} bg-amber-500/15 text-amber-900 dark:text-amber-200`}>Short</span>;
  }
  return <span className={`${base} bg-zinc-500/10 text-zinc-700 dark:text-zinc-300`}>—</span>;
}
