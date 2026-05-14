"use client";

import { useEffect, useMemo, useState } from "react";

import { Alert, Button, Card, CardBody } from "@repo/adricore/blocks";

import type { ExecutionModeValue, ExecutorAssetFilterMode } from "./actions";
import { createExecutor, updateExecutor } from "./actions";

export type AssetOption = { id: string; code: string };
export type ExchangeOption = { id: string; code: string; name: string };

/** Side an executor may take. Mirrors trading.position_side enum. */
export type PositionSide = "long" | "short";

/**
 * Per-exchange capability flags that gate which sides the user may pick.
 * Mirrors the boolean columns added in 20260723110000_exchange_capabilities.sql.
 *
 * `long` is allowed if the exchange supports either spot buy or margin long.
 * `short` is allowed if the exchange supports margin short. Pure-spot venues
 * (e.g. Bitvavo) therefore offer "long" only and the "short" checkbox is hidden.
 */
export type ExchangeCapabilities = {
  supports_spot_buy: boolean;
  supports_spot_sell: boolean;
  supports_margin_long: boolean;
  supports_margin_short: boolean;
};

export type ExecutorQuoteBudgetInitial = {
  /** catalog.assets.id of the quote asset (e.g. EUR / USDT) */
  quote_asset_id: string;
  /** Number stored in the OWNER's primary fiat (e.g. EUR or USD), matches max_notional_primary. */
  max_notional_primary: string;
};

export type ExecutorFormInitial = {
  name: string;
  enabled: boolean;
  execution_mode: ExecutionModeValue;
  exchange_id?: string;
  asset_filter_mode: ExecutorAssetFilterMode;
  filter_asset_ids: string[];
  /** Existing trading.executor_quote_asset_budget rows for this executor (edit/clone). */
  quote_budgets?: ExecutorQuoteBudgetInitial[];
  max_risk_per_trade?: string;
  max_open_positions?: string;
  max_exposure_per_symbol_eur?: string;
  daily_loss_limit_eur?: string;
  max_drawdown_eur?: string;
  cooldown_after_losses?: string;
  allow_add?: boolean;
  profit_taking_enabled?: boolean;
  moving_floor_trail_pct?: string;
  moving_floor_activation_profit_pct?: string;
  moving_floor_timeframe?: string;
  mediator_rails_extra_json?: string;
  /** When unset on create, defaults to on (matches DB default). */
  slack_trade_notifications_enabled?: boolean;
  historical_start_date?: string | null;
  historical_end_date?: string | null;
  /** Server-derived: both key and secret non-empty in DB (no raw values sent to the client). */
  exchange_api_credentials_configured?: boolean;
  /** Last few characters of stored key for display only (edit mode). */
  exchange_api_key_suffix?: string;
  /** Subset of trading.position_side this executor may take. Defaults to ["long"]. */
  allowed_sides?: PositionSide[];
};

type BudgetRow = {
  /** Local key so React keeps inputs stable across add/remove. */
  key: number;
  quote_asset_id: string;
  max_notional_primary: string;
};

let budgetKeySeq = 0;
const nextBudgetKey = () => ++budgetKeySeq;

export function ExecutorForm({
  mode,
  executorId,
  assetOptions,
  exchangeOptions,
  quoteAssetOptionsByExchange,
  exchangeCapabilitiesById,
  primaryAssetCode,
  initial,
  onSaved,
}: {
  mode: "create" | "edit";
  executorId?: string;
  assetOptions: AssetOption[];
  exchangeOptions: ExchangeOption[];
  /**
   * Distinct quote-asset choices per exchange, derived from `catalog.markets`.
   * Used by the "Quote-asset budgets" editor so users only pick quotes that the
   * selected exchange actually trades.
   */
  quoteAssetOptionsByExchange?: Record<string, AssetOption[]>;
  /**
   * Capability flags per `catalog.exchanges.id`. Drives the "Allowed sides"
   * checkbox visibility — e.g. Bitvavo (spot-only) hides the short option.
   */
  exchangeCapabilitiesById?: Record<string, ExchangeCapabilities>;
  /** ISO code of the user's primary fiat (e.g. "EUR" / "USD"). Used as the budgets unit label. */
  primaryAssetCode?: string;
  initial?: ExecutorFormInitial;
  /** Called after a successful create or update (server action completed without throwing). */
  onSaved?: () => void;
}) {
  const [filterMode, setFilterMode] = useState<ExecutorAssetFilterMode>(
    initial?.execution_mode === "historical" ? "whitelist" : (initial?.asset_filter_mode ?? "all"),
  );
  const [execMode, setExecMode] = useState<ExecutionModeValue>(initial?.execution_mode ?? "paper");
  const [exchangeId, setExchangeId] = useState<string>(
    initial?.exchange_id ?? exchangeOptions[0]?.id ?? "",
  );

  const [budgets, setBudgets] = useState<BudgetRow[]>(() => {
    const initRows = (initial?.quote_budgets ?? []).map((b) => ({
      key: nextBudgetKey(),
      quote_asset_id: b.quote_asset_id,
      max_notional_primary: b.max_notional_primary,
    }));
    if (initRows.length > 0) return initRows;
    // First-time create: no rows yet.
    return [{ key: nextBudgetKey(), quote_asset_id: "", max_notional_primary: "100" }];
  });

  const quoteOptionsForCurrentExchange = useMemo(() => {
    const map = quoteAssetOptionsByExchange ?? {};
    const list = map[exchangeId] ?? [];
    return list;
  }, [quoteAssetOptionsByExchange, exchangeId]);

  const primaryCode = primaryAssetCode?.trim() || "EUR";

  // Sides framework. The selected sides default to the saved row's value, or
  // ["long"] for new executors. When the exchange changes we strip any side that
  // the new exchange doesn't support (pure spot exchanges hide "short"); this
  // matches the DB CHECK that requires at least one element.
  const initialSides: PositionSide[] =
    initial?.allowed_sides && initial.allowed_sides.length > 0 ? initial.allowed_sides : ["long"];
  const [allowedSides, setAllowedSides] = useState<PositionSide[]>(initialSides);

  const capabilities = useMemo<ExchangeCapabilities | null>(() => {
    return exchangeCapabilitiesById?.[exchangeId] ?? null;
  }, [exchangeCapabilitiesById, exchangeId]);

  const longSupported = capabilities ? capabilities.supports_spot_buy || capabilities.supports_margin_long : true;
  const shortSupported = capabilities ? capabilities.supports_margin_short : false;

  useEffect(() => {
    setAllowedSides((prev) => {
      const next = prev.filter((s) => (s === "long" ? longSupported : shortSupported));
      // Never let the array go empty — fall back to "long" when the exchange supports it.
      if (next.length === 0 && longSupported) return ["long"];
      if (next.length === 0 && shortSupported) return ["short"];
      return next;
    });
  }, [longSupported, shortSupported]);

  useEffect(() => {
    if (execMode === "historical") {
      setFilterMode("whitelist");
    }
  }, [execMode]);

  return (
    <Card>
      <CardBody className="bk-stack bk-stack_gap-md">
        <form
          className="bk-stack bk-stack_gap-md"
          action={async (formData) => {
            if (mode === "create") {
              await createExecutor(formData);
            } else {
              if (!executorId) throw new Error("Missing executor id");
              await updateExecutor(executorId, formData);
            }
            onSaved?.();
          }}
        >
          {mode === "edit" && initial ? (
            <input type="hidden" name="_previous_execution_mode" value={initial.execution_mode} readOnly />
          ) : null}
          <div>
            <label htmlFor="ex-name" className="bk-form-label">
              Name
            </label>
            <input
              id="ex-name"
              name="name"
              className="bk-input mt-1 w-full max-w-md font-mono text-sm"
              defaultValue={initial?.name ?? ""}
              required
            />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="enabled" defaultChecked={Boolean(initial?.enabled)} />
            Enabled
          </label>

          {execMode !== "historical" ? (
            <label className="flex cursor-pointer flex-col gap-1 text-sm">
              <span className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="slack_trade_notifications_enabled"
                  defaultChecked={initial?.slack_trade_notifications_enabled !== false}
                />
                Slack trade-fill notifications
              </span>
              <span className="bk-text-muted pl-6 text-xs">
                When enabled, trade fills for this executor may post to Slack if{" "}
                <code className="font-mono text-[var(--text)]">TRADE_FILL_SLACK_WEBHOOK_URL</code> is set. No webhook
                means nothing is sent either way.
              </span>
            </label>
          ) : (
            <p className="bk-text-muted text-xs">
              Slack trade-fill notifications are disabled for historical executors (cannot be enabled).
            </p>
          )}

          <div>
            <label htmlFor="ex-mode" className="bk-form-label">
              Execution mode
            </label>
            <select
              id="ex-mode"
              name="execution_mode"
              className="bk-input mt-1 w-full max-w-md font-mono text-sm"
              value={execMode}
              onChange={(e) => {
                setExecMode(e.target.value as ExecutionModeValue);
              }}
            >
              <option value="paper">Paper (simulated fills)</option>
              <option value="live">Live (Bitvavo — server API keys)</option>
              <option value="historical">Historical (backtest date range — paper only)</option>
            </select>
          </div>

          {execMode === "historical" ? (
            <Alert tone="warning">
              <p className="text-sm">
                Historical runs overwrite <strong className="text-[var(--text)]">shared</strong> rows in{" "}
                <code className="font-mono text-[var(--text)]">trading.signals</code> for your user and this market for
                each bar in the range. Use a dedicated account or accept that signal history for that market may
                change.
              </p>
            </Alert>
          ) : null}

          {execMode === "historical" ? (
            <div className="bk-stack bk-stack_gap-sm">
              <div>
                <label htmlFor="ex-hist-start" className="bk-form-label">
                  Historical start date (UTC calendar day)
                </label>
                <input
                  id="ex-hist-start"
                  name="historical_start_date"
                  type="date"
                  className="bk-input mt-1 w-full max-w-md font-mono text-sm"
                  defaultValue={initial?.historical_start_date ?? ""}
                  required
                />
              </div>
              <div>
                <label htmlFor="ex-hist-end" className="bk-form-label">
                  Historical end date (UTC calendar day)
                </label>
                <input
                  id="ex-hist-end"
                  name="historical_end_date"
                  type="date"
                  className="bk-input mt-1 w-full max-w-md font-mono text-sm"
                  defaultValue={initial?.historical_end_date ?? ""}
                  required
                />
              </div>
              <p className="bk-text-muted text-xs">
                Bitvavo 15m candles only. Exchange must be Bitvavo. One base asset in the whitelist. Run requires a
                positive paper balance on that same base asset.
              </p>
            </div>
          ) : null}

          <div>
            <label htmlFor="ex-exchange" className="bk-form-label">
              Exchange
            </label>
            <select
              id="ex-exchange"
              name="exchange_id"
              className="bk-input mt-1 w-full max-w-md font-mono text-sm"
              value={exchangeId}
              onChange={(e) => setExchangeId(e.target.value)}
              required
            >
              {exchangeOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.code} — {opt.name}
                </option>
              ))}
            </select>
          </div>

          <div className="border-border bk-text-muted border-t pt-4 text-xs font-medium uppercase tracking-wide">
            Exchange API credentials
          </div>
          <p className="bk-text-muted text-xs">
            Used for <strong className="text-[var(--text)]">private</strong> REST calls (e.g. Bitvavo signed orders and
            order status). Stored on this executor row; not read from{" "}
            <code className="font-mono text-[var(--text)]">.env</code>.
          </p>
          {mode === "edit" && initial?.exchange_api_credentials_configured ? (
            <p className="bk-text-muted text-xs">
              Credentials are saved. Key ends with{" "}
              <span className="font-mono text-[var(--text)]">{initial.exchange_api_key_suffix ?? "…"}</span>. Leave the
              fields below empty to keep the current key and secret; fill to replace.
            </p>
          ) : mode === "edit" ? (
            <p className="bk-text-muted text-xs">Leave empty if unchanged. Live trading needs both key and secret.</p>
          ) : null}
          <div>
            <label htmlFor="ex-exchange-api-key" className="bk-form-label">
              Exchange API key
            </label>
            <input
              id="ex-exchange-api-key"
              name="exchange_api_key"
              type="text"
              autoComplete="off"
              className="bk-input mt-1 w-full max-w-md font-mono text-sm"
              required={mode === "create" && execMode === "live"}
            />
          </div>
          <div>
            <label htmlFor="ex-exchange-api-secret" className="bk-form-label">
              Exchange API secret
            </label>
            <input
              id="ex-exchange-api-secret"
              name="exchange_api_secret"
              type="password"
              autoComplete="off"
              className="bk-input mt-1 w-full max-w-md font-mono text-sm"
              required={mode === "create" && execMode === "live"}
            />
          </div>

          {execMode === "live" && (mode === "create" || initial?.execution_mode !== "live") ? (
            <Alert tone="warning">
              <label className="flex cursor-pointer items-start gap-2 text-sm">
                <input type="checkbox" name="live_ack" className="mt-1" required />
                <span>
                  I confirm live trading for this executor: real market orders may be placed when decisions are
                  approved.
                </span>
              </label>
            </Alert>
          ) : execMode === "live" ? (
            <Alert tone="warning">This executor is in live mode. Switch to paper first if you need to acknowledge again.</Alert>
          ) : null}

          <div className="border-border bk-text-muted border-t pt-4 text-xs font-medium uppercase tracking-wide">
            Quote-asset budgets
          </div>
          <p className="bk-text-muted text-xs">
            One row per allowed quote on this exchange. Notional is stored in your primary fiat (
            <code className="font-mono text-[var(--text)]">{primaryCode}</code>) and converted to the market quote
            at decision time using each asset&rsquo;s <code className="font-mono text-[var(--text)]">dollar_value</code>.
            Markets whose quote is not listed here are skipped with reason{" "}
            <code className="font-mono text-[var(--text)]">quote_asset_not_allowed</code>.
          </p>

          <div className="bk-stack bk-stack_gap-sm">
            {budgets.map((row, idx) => (
              <div key={row.key} className="flex flex-wrap items-end gap-2">
                <div>
                  <label
                    htmlFor={`ex-budget-quote-${row.key}`}
                    className="bk-form-label text-xs"
                  >
                    Quote asset
                  </label>
                  <select
                    id={`ex-budget-quote-${row.key}`}
                    name="quote_budget_quote_asset_id"
                    className="bk-input mt-1 w-44 font-mono text-sm"
                    value={row.quote_asset_id}
                    onChange={(e) => {
                      const v = e.target.value;
                      setBudgets((prev) =>
                        prev.map((b, i) => (i === idx ? { ...b, quote_asset_id: v } : b)),
                      );
                    }}
                    required
                  >
                    <option value="">— Select quote —</option>
                    {quoteOptionsForCurrentExchange.length === 0 ? (
                      <option value="" disabled>
                        (no quote markets known for this exchange)
                      </option>
                    ) : null}
                    {quoteOptionsForCurrentExchange.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.code}
                      </option>
                    ))}
                    {/* Stale fallback: keep current value visible even if it is not in the options list. */}
                    {row.quote_asset_id &&
                    !quoteOptionsForCurrentExchange.some((o) => o.id === row.quote_asset_id) ? (
                      <option value={row.quote_asset_id}>
                        (current: {row.quote_asset_id.slice(0, 8)}…)
                      </option>
                    ) : null}
                  </select>
                </div>
                <div>
                  <label
                    htmlFor={`ex-budget-amount-${row.key}`}
                    className="bk-form-label text-xs"
                  >
                    Max notional ({primaryCode})
                  </label>
                  <input
                    id={`ex-budget-amount-${row.key}`}
                    name="quote_budget_max_notional_primary"
                    type="number"
                    min={0.01}
                    step="0.01"
                    inputMode="decimal"
                    className="bk-input mt-1 w-44 font-mono text-sm"
                    value={row.max_notional_primary}
                    onChange={(e) => {
                      const v = e.target.value;
                      setBudgets((prev) =>
                        prev.map((b, i) => (i === idx ? { ...b, max_notional_primary: v } : b)),
                      );
                    }}
                    required
                  />
                </div>
                <Button
                  type="button"
                  variant="neutral"
                  size="sm"
                  onClick={() => {
                    setBudgets((prev) =>
                      prev.length === 1 ? prev : prev.filter((_, i) => i !== idx),
                    );
                  }}
                  disabled={budgets.length === 1}
                  title={
                    budgets.length === 1
                      ? "Need at least one budget row."
                      : "Remove this quote-asset budget."
                  }
                >
                  Remove
                </Button>
              </div>
            ))}
            <div>
              <Button
                type="button"
                variant="neutral"
                size="sm"
                onClick={() =>
                  setBudgets((prev) => [
                    ...prev,
                    { key: nextBudgetKey(), quote_asset_id: "", max_notional_primary: "100" },
                  ])
                }
              >
                Add quote-asset budget
              </Button>
            </div>
          </div>

          <div className="border-border bk-text-muted border-t pt-4 text-xs font-medium uppercase tracking-wide">
            Allowed position sides
          </div>
          <p className="bk-text-muted text-xs">
            The mediator only emits decisions for sides this executor allows; the executor rejects orders for any
            side not listed here with reason{" "}
            <code className="font-mono text-[var(--text)]">side_not_allowed</code>. The exchange itself further
            limits which sides can ever be picked (Bitvavo is spot-only, so &quot;short&quot; is unavailable).
          </p>
          <div className="bk-stack bk-stack_gap-xs">
            {longSupported ? (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="allowed_sides"
                  value="long"
                  checked={allowedSides.includes("long")}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setAllowedSides((prev) => {
                      const without = prev.filter((s) => s !== "long");
                      const next = checked ? [...without, "long" as const] : without;
                      // Enforce at least one selected side (DB CHECK).
                      return next.length ? next : prev;
                    });
                  }}
                />
                Long (spot buy or margin long)
              </label>
            ) : (
              <p className="bk-text-muted text-xs">
                This exchange does not support long entries (no spot buy and no margin long).
              </p>
            )}
            {shortSupported ? (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="allowed_sides"
                  value="short"
                  checked={allowedSides.includes("short")}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setAllowedSides((prev) => {
                      const without = prev.filter((s) => s !== "short");
                      const next = checked ? [...without, "short" as const] : without;
                      return next.length ? next : prev;
                    });
                  }}
                />
                Short (margin short — execution stub for now)
              </label>
            ) : (
              <p className="bk-text-muted text-xs">
                This exchange does not support short selling.
              </p>
            )}
          </div>

          <div className="border-border bk-text-muted border-t pt-4 text-xs font-medium uppercase tracking-wide">
            Mediator / risk rails
          </div>

          <div>
            <label htmlFor="ex-max-risk" className="bk-form-label">
              Max risk per trade (0–1)
            </label>
            <input
              id="ex-max-risk"
              name="max_risk_per_trade"
              type="number"
              min={0.0001}
              max={1}
              step="any"
              inputMode="decimal"
              className="bk-input mt-1 w-full max-w-md font-mono text-sm"
              defaultValue={initial?.max_risk_per_trade ?? "0.05"}
              required
            />
            <p className="bk-text-muted mt-1 text-xs">
              Fraction of equity per trade cap, e.g. 0.05 = 5%. Use a dot as decimal separator (not a comma).
            </p>
          </div>

          <div>
            <label htmlFor="ex-max-open" className="bk-form-label">
              Max open positions
            </label>
            <input
              id="ex-max-open"
              name="max_open_positions"
              type="number"
              min={0}
              step="1"
              className="bk-input mt-1 w-full max-w-md font-mono text-sm"
              defaultValue={initial?.max_open_positions ?? "5"}
              required
            />
          </div>

          <div>
            <label htmlFor="ex-max-exp" className="bk-form-label">
              Max exposure per symbol (EUR)
            </label>
            <input
              id="ex-max-exp"
              name="max_exposure_per_symbol_eur"
              type="number"
              min={0}
              step="1"
              className="bk-input mt-1 w-full max-w-md font-mono text-sm"
              defaultValue={initial?.max_exposure_per_symbol_eur ?? "500"}
              required
            />
          </div>

          <div>
            <label htmlFor="ex-daily-loss" className="bk-form-label">
              Daily loss limit (EUR)
            </label>
            <input
              id="ex-daily-loss"
              name="daily_loss_limit_eur"
              type="number"
              min={0}
              step="1"
              className="bk-input mt-1 w-full max-w-md font-mono text-sm"
              defaultValue={initial?.daily_loss_limit_eur ?? "100"}
              required
            />
          </div>

          <div>
            <label htmlFor="ex-max-dd" className="bk-form-label">
              Max drawdown (EUR)
            </label>
            <input
              id="ex-max-dd"
              name="max_drawdown_eur"
              type="number"
              min={0}
              step="1"
              className="bk-input mt-1 w-full max-w-md font-mono text-sm"
              defaultValue={initial?.max_drawdown_eur ?? "500"}
              required
            />
          </div>

          <div>
            <label htmlFor="ex-cooldown" className="bk-form-label">
              Cooldown after losses (count)
            </label>
            <input
              id="ex-cooldown"
              name="cooldown_after_losses"
              type="number"
              min={0}
              step="1"
              className="bk-input mt-1 w-full max-w-md font-mono text-sm"
              defaultValue={initial?.cooldown_after_losses ?? "3"}
              required
            />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="allow_add" defaultChecked={initial?.allow_add === true} />
            Allow ADD intent (extra buys when already in position)
          </label>

          <div className="border-border bk-text-muted border-t pt-4 text-xs font-medium uppercase tracking-wide">
            Profit taking / moving floor
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="profit_taking_enabled" defaultChecked={initial?.profit_taking_enabled === true} />
            Enable moving-floor profit taking
          </label>

          <div>
            <label htmlFor="ex-floor-trail" className="bk-form-label">
              Moving floor trail percent (0–1)
            </label>
            <input
              id="ex-floor-trail"
              name="moving_floor_trail_pct"
              type="number"
              min={0.0001}
              max={0.99}
              step="any"
              className="bk-input mt-1 w-full max-w-md font-mono text-sm"
              defaultValue={initial?.moving_floor_trail_pct ?? "0.15"}
              required
            />
          </div>

          <div>
            <label htmlFor="ex-floor-activation" className="bk-form-label">
              Activation profit percent (0–1)
            </label>
            <input
              id="ex-floor-activation"
              name="moving_floor_activation_profit_pct"
              type="number"
              min={0}
              max={0.99}
              step="any"
              className="bk-input mt-1 w-full max-w-md font-mono text-sm"
              defaultValue={initial?.moving_floor_activation_profit_pct ?? "0.05"}
              required
            />
          </div>

          <div>
            <label htmlFor="ex-floor-timeframe" className="bk-form-label">
              Moving floor timeframe
            </label>
            <input
              id="ex-floor-timeframe"
              name="moving_floor_timeframe"
              className="bk-input mt-1 w-full max-w-md font-mono text-sm"
              defaultValue={initial?.moving_floor_timeframe ?? "15m"}
              required
            />
          </div>

          <div>
            <label htmlFor="ex-rails-extra" className="bk-form-label">
              Advanced rails (JSON object, optional)
            </label>
            <textarea
              id="ex-rails-extra"
              name="mediator_rails_extra"
              rows={5}
              className="bk-input mt-1 w-full max-w-2xl font-mono text-xs"
              defaultValue={initial?.mediator_rails_extra_json ?? "{}"}
              spellCheck={false}
            />
            <p className="bk-text-muted mt-1 text-xs">Overrides typed fields when keys match (camelCase).</p>
          </div>

          <div>
            <label htmlFor="ex-filter-mode" className="bk-form-label">
              Asset filter
            </label>
            {execMode === "historical" ? (
              <>
                <input type="hidden" name="asset_filter_mode" value="whitelist" readOnly />
                <p className="bk-text-muted mt-1 text-xs">Whitelist only (required for historical).</p>
              </>
            ) : (
              <select
                id="ex-filter-mode"
                name="asset_filter_mode"
                className="bk-input mt-1 w-full max-w-md font-mono text-sm"
                value={filterMode}
                onChange={(e) => setFilterMode(e.target.value as ExecutorAssetFilterMode)}
              >
                <option value="all">All assets</option>
                <option value="whitelist">Whitelist (only listed base assets)</option>
                <option value="blacklist">Blacklist (all except listed base assets)</option>
              </select>
            )}
          </div>

          {execMode === "historical" ? (
            <div>
              <label htmlFor="ex-assets-hist" className="bk-form-label">
                Asset (exactly one)
              </label>
              <select
                id="ex-assets-hist"
                name="filter_asset_ids"
                className="bk-input mt-1 w-full max-w-md font-mono text-sm"
                defaultValue={(initial?.filter_asset_ids ?? [])[0] ?? ""}
                required
              >
                <option value="">— Select one asset —</option>
                {assetOptions.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code}
                  </option>
                ))}
              </select>
            </div>
          ) : filterMode !== "all" ? (
            <div>
              <label htmlFor="ex-assets" className="bk-form-label">
                Assets (base)
              </label>
              <select
                id="ex-assets"
                name="filter_asset_ids"
                multiple
                className="bk-input mt-1 h-48 w-full max-w-md font-mono text-xs"
                defaultValue={initial?.filter_asset_ids ?? []}
              >
                {assetOptions.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code}
                  </option>
                ))}
              </select>
              <p className="bk-text-muted mt-1 text-xs">Hold Ctrl/Cmd to select multiple.</p>
            </div>
          ) : null}

          <Button type="submit">{mode === "create" ? "Create executor" : "Save changes"}</Button>
        </form>
      </CardBody>
    </Card>
  );
}
