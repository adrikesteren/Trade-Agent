import { Redis } from "@upstash/redis";

export function createRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

const LOCK_PREFIX = "lock:";

export type LockHandle = { key: string; token: string };

/**
 * Best-effort distributed lock using SET NX PX. Release with token match via Lua would be ideal;
 * for MVP we delete only if value matches using GET+DEL pattern (small race window acceptable for ingest ticks).
 */
export async function acquireLock(
  redis: Redis,
  name: string,
  ttlMs: number,
): Promise<LockHandle | null> {
  const token = crypto.randomUUID();
  const key = `${LOCK_PREFIX}${name}`;
  const ok = await redis.set(key, token, { nx: true, px: ttlMs });
  if (ok !== "OK") return null;
  return { key, token };
}

export async function releaseLock(redis: Redis, handle: LockHandle): Promise<void> {
  const current = await redis.get<string>(handle.key);
  if (current === handle.token) {
    await redis.del(handle.key);
  }
}

export async function idempotentOnce(
  redis: Redis,
  key: string,
  ttlSeconds: number,
): Promise<boolean> {
  const full = `idemp:${key}`;
  const r = await redis.set(full, "1", { nx: true, ex: ttlSeconds });
  return r === "OK";
}
