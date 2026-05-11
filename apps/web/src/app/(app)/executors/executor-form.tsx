"use client";

import { useState } from "react";

import { Alert, Button, Card, CardBody } from "@repo/blocks";

import type { ExecutionModeValue, ExecutorAssetFilterMode } from "./actions";
import { createExecutor, updateExecutor } from "./actions";

export type AssetOption = { id: string; code: string };
export type ExchangeOption = { id: string; code: string; name: string };

export type ExecutorFormInitial = {
  name: string;
  enabled: boolean;
  execution_mode: ExecutionModeValue;
  exchange_id?: string;
  asset_filter_mode: ExecutorAssetFilterMode;
  filter_asset_ids: string[];
  default_notional_eur?: string;
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
  /** Server-derived: both key and secret non-empty in DB (no raw values sent to the client). */
  exchange_api_credentials_configured?: boolean;
  /** Last few characters of stored key for display only (edit mode). */
  exchange_api_key_suffix?: string;
};

export function ExecutorForm({
  mode,
  executorId,
  assetOptions,
  exchangeOptions,
  initial,
  onSaved,
}: {
  mode: "create" | "edit";
  executorId?: string;
  assetOptions: AssetOption[];
  exchangeOptions: ExchangeOption[];
  initial?: ExecutorFormInitial;
  /** Called after a successful create or update (server action completed without throwing). */
  onSaved?: () => void;
}) {
  const [filterMode, setFilterMode] = useState<ExecutorAssetFilterMode>(initial?.asset_filter_mode ?? "all");
  const [execMode, setExecMode] = useState<ExecutionModeValue>(initial?.execution_mode ?? "paper");

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
            </select>
          </div>

          <div>
            <label htmlFor="ex-exchange" className="bk-form-label">
              Exchange
            </label>
            <select
              id="ex-exchange"
              name="exchange_id"
              className="bk-input mt-1 w-full max-w-md font-mono text-sm"
              defaultValue={initial?.exchange_id ?? exchangeOptions[0]?.id ?? ""}
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
            Mediator / risk rails
          </div>

          <div>
            <label htmlFor="ex-default-notional" className="bk-form-label">
              Default order size (EUR)
            </label>
            <input
              id="ex-default-notional"
              name="default_notional_eur"
              type="number"
              min={0.01}
              step="0.01"
              className="bk-input mt-1 w-full max-w-md font-mono text-sm"
              defaultValue={initial?.default_notional_eur ?? "100"}
              required
            />
            <p className="bk-text-muted mt-1 text-xs">Suggested EUR per trade before equity cap (mediator).</p>
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
          </div>

          {filterMode !== "all" ? (
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
