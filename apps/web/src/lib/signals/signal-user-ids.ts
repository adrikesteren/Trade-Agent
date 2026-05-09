/**
 * Trusted user UUIDs for service-role signal writes (env only — never from unsigned clients).
 */
export function parseSignalUserIdsFromEnv(): string[] {
  const multi = process.env.SIGNAL_USER_IDS?.trim();
  if (multi) {
    return multi
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  const one = process.env.SIGNAL_DEFAULT_USER_ID?.trim();
  if (one) return [one];
  return [];
}
