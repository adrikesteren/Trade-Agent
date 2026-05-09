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
  budget_eur: string | null;
  asset_filter_mode: ExecutorAssetFilterMode;
  filter_asset_ids: string[];
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
            <input type="checkbox" name="enabled" defaultChecked={initial?.enabled !== false} />
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

          <div>
            <label htmlFor="ex-budget" className="bk-form-label">
              Budget (EUR)
            </label>
            <input
              id="ex-budget"
              name="budget_eur"
              type="number"
              min={0}
              step="0.01"
              className="bk-input mt-1 w-full max-w-md font-mono text-sm"
              placeholder="Unlimited if empty"
              defaultValue={initial?.budget_eur ?? ""}
            />
            <p className="bk-text-muted mt-1 text-xs">Caps cumulative filled buy notional for this executor.</p>
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
