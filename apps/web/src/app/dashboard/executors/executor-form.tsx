"use client";

import { useState } from "react";

import { Alert, Button, Card, CardBody } from "@repo/blocks";

import type { ExecutionModeValue, ExecutorAssetFilterMode } from "./actions";
import { createExecutor, updateExecutor } from "./actions";

export type AssetOption = { id: string; code: string };

export type ExecutorFormInitial = {
  name: string;
  enabled: boolean;
  execution_mode: ExecutionModeValue;
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
  mediator_rails_extra_json?: string;
};

export function ExecutorForm({
  mode,
  executorId,
  assetOptions,
  initial,
}: {
  mode: "create" | "edit";
  executorId?: string;
  assetOptions: AssetOption[];
  initial?: ExecutorFormInitial;
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
              step="0.001"
              className="bk-input mt-1 w-full max-w-md font-mono text-sm"
              defaultValue={initial?.max_risk_per_trade ?? "0.05"}
              required
            />
            <p className="bk-text-muted mt-1 text-xs">Fraction of equity per trade cap, e.g. 0.05 = 5%.</p>
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
