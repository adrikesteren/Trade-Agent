import "server-only";

export type OpsAlertLevel = "error" | "warning";

export type OpsAlertPayload = {
  source: string;
  level: OpsAlertLevel;
  title: string;
  detail: string;
  at: string;
};

/**
 * Optional webhook for operator visibility. Never throws to callers; logs on failure.
 */
export async function sendOpsAlert(payload: OpsAlertPayload): Promise<void> {
  const url = process.env.OPS_ALERT_WEBHOOK_URL?.trim();
  if (!url) return;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 8000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: ac.signal,
    });
    if (!res.ok) {
      console.error(`sendOpsAlert: webhook HTTP ${res.status} for ${payload.source}`);
    }
  } catch (e) {
    console.error("sendOpsAlert: webhook failed:", e instanceof Error ? e.message : e);
  } finally {
    clearTimeout(timer);
  }
}
