"use client";

import { useState } from "react";

import { Alert, Button, Card, CardBody } from "@repo/blocks";

import type { ExecutionModeValue } from "./actions";
import { updateExecutionMode } from "./actions";

export function ExecutionModeForm({ initialMode }: { initialMode: ExecutionModeValue }) {
  const [mode, setMode] = useState<ExecutionModeValue>(initialMode);
  const [liveAck, setLiveAck] = useState(false);

  return (
    <Card>
      <CardBody className="bk-stack bk-stack_gap-md">
        <form
          className="bk-stack bk-stack_gap-md"
          action={async (formData) => {
            formData.set("execution_mode", mode);
            await updateExecutionMode(formData);
          }}
        >
          <div>
            <label htmlFor="exec-mode" className="bk-form-label">
              Execution mode
            </label>
            <select
              id="exec-mode"
              className="bk-input mt-1 w-full max-w-md font-mono text-sm"
              value={mode}
              onChange={(e) => {
                const v = e.target.value as ExecutionModeValue;
                setMode(v);
                if (v !== "live") setLiveAck(false);
              }}
            >
              <option value="paper">Paper (simulated fills, no exchange orders)</option>
              <option value="live">Live (real Bitvavo orders — use at your own risk)</option>
            </select>
          </div>

          {mode === "live" ? (
            <Alert tone="warning">
              <label className="flex cursor-pointer items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={liveAck}
                  onChange={(e) => setLiveAck(e.target.checked)}
                />
                <span>
                  I confirm I want <strong>live</strong> trading: the executor will place real market orders on Bitvavo
                  when the mediator approves a decision, using server API keys. I understand capital can be lost.
                </span>
              </label>
            </Alert>
          ) : null}

          <Button type="submit" disabled={mode === "live" && !liveAck}>
            Save preference
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}
