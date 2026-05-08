/**
 * Public HTTPS origin for this deployment (used to queue QStash follow-up jobs to our own routes).
 */
export function workerPublicBaseUrl(): string | null {
  const u = process.env.APP_BASE_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  if (u) return u.replace(/\/$/, "");
  const v = process.env.VERCEL_URL;
  if (!v) return null;
  const trimmed = v.replace(/^https?:\/\//, "");
  return `https://${trimmed}`;
}
