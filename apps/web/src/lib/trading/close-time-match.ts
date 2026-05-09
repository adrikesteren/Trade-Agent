/** True when two ISO close-time strings refer to the same catalog bar (within 2s). */
export function closeTimesMatch(a: string, b: string): boolean {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isFinite(ta) && Number.isFinite(tb)) return Math.abs(ta - tb) < 2000;
  return a === b;
}
