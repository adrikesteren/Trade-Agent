import { describe, expect, it, vi } from "vitest";

import { resolveExecutorWalletId } from "./executor-wallet-resolve.service";

type Builder = {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
};

function makeBuilder(result: { data: unknown; error: unknown }): Builder {
  const b: Partial<Builder> = {};
  b.select = vi.fn().mockReturnValue(b);
  b.eq = vi.fn().mockReturnValue(b);
  b.maybeSingle = vi.fn().mockResolvedValue(result);
  return b as Builder;
}

function makeAdmin({
  executors,
  wallets,
}: {
  executors: { data: unknown; error: unknown };
  wallets: { data: unknown; error: unknown };
}) {
  const tradingFrom = vi.fn().mockImplementation((table: string) => {
    if (table === "executors") return makeBuilder(executors);
    if (table === "wallets") return makeBuilder(wallets);
    throw new Error(`unexpected table ${table}`);
  });
  const schema = vi.fn().mockReturnValue({ from: tradingFrom });
  return { schema };
}

describe("resolveExecutorWalletId", () => {
  it("returns executors.wallet_id when present (preferred path)", async () => {
    const admin = makeAdmin({
      executors: { data: { wallet_id: "W1" }, error: null },
      wallets: { data: null, error: null },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await resolveExecutorWalletId(admin as any, { executorId: "e1" });
    expect(out).toBe("W1");
  });

  it("falls back to wallets.executor_id when wallet_id is missing on executor", async () => {
    const admin = makeAdmin({
      executors: { data: { wallet_id: null }, error: null },
      wallets: { data: { id: "W2" }, error: null },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await resolveExecutorWalletId(admin as any, { executorId: "e1" });
    expect(out).toBe("W2");
  });

  it("returns null when neither lookup matches", async () => {
    const admin = makeAdmin({
      executors: { data: null, error: null },
      wallets: { data: null, error: null },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await resolveExecutorWalletId(admin as any, { executorId: "e1" });
    expect(out).toBeNull();
  });
});
