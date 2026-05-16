import "server-only";

import type { IExchangeAdapter } from "./exchange-adapter";

/**
 * Process-local registry keyed by `exchanges.id` (UUID), populated at bootstrap.
 * Consumers (domain services) resolve adapters via `getAdapter(exchangeId)`.
 */
const registry = new Map<string, IExchangeAdapter>();

/** Register or overwrite an adapter for the given exchange row id. */
export function registerAdapter(exchangeId: string, adapter: IExchangeAdapter): void {
  registry.set(exchangeId, adapter);
}

/** Resolve an adapter by exchange id; throws when none is registered. */
export function getAdapter(exchangeId: string): IExchangeAdapter {
  const adapter = registry.get(exchangeId);
  if (!adapter) {
    throw new Error(
      `No exchange adapter registered for id=${exchangeId}. Did you call ensureExchangeAdaptersBootstrapped()?`,
    );
  }
  return adapter;
}

/** True when an adapter is registered for the given exchange id. */
export function hasAdapter(exchangeId: string): boolean {
  return registry.has(exchangeId);
}
