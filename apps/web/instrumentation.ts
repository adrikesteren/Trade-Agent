/**
 * Next.js instrumentation hook — runs once per server process on cold-start.
 *
 * We use it to bootstrap the exchange-adapter registry (Plan 2 Layer 1) so domain services
 * can call `getAdapter(exchangeId)` without having to await registration on every request.
 * Bootstrap failures are logged but do not throw — the underlying `getAdapter` call will
 * raise a clear error if a service tries to use an unregistered adapter, which keeps the
 * server bootable when Supabase is briefly unreachable at start.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { ensureExchangeAdaptersBootstrapped } = await import("@/lib/exchanges/bootstrap");
    await ensureExchangeAdaptersBootstrapped().catch((e) => {
      console.error("[instrumentation] exchange adapter bootstrap failed:", e);
    });
  }
}
