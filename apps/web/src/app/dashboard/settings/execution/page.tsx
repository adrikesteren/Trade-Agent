import { ExecutionModeForm } from "./execution-mode-form";
import { createClient } from "@/lib/supabase/server";
import { Alert, Card, CardBody, PageHeader, Stack } from "@repo/blocks";
import { redirect } from "next/navigation";

import type { ExecutionModeValue } from "./actions";

export default async function ExecutionSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: pref, error } = await supabase
    .schema("trading")
    .from("user_execution_preferences")
    .select("execution_mode")
    .eq("user_id", user.id)
    .maybeSingle();

  const initialMode: ExecutionModeValue =
    pref?.execution_mode === "live" || pref?.execution_mode === "paper" ? pref.execution_mode : "paper";

  return (
    <div className="bk-container bk-container_lg bk-stack bk-stack_gap-md">
      <PageHeader
        title="Execution mode"
        subtitle="Paper vs live affects new trade_decisions, positions, and orders. Keys for live orders are read from server environment (see README)."
      />
      {error ? <Alert tone="error">{error.message}</Alert> : null}
      <Stack gap="md">
        <Card>
          <CardBody>
            <p className="bk-text-muted text-sm">
              Default is <strong>Paper</strong> until you save a preference. The mediator snapshots your mode on each
              bar into <code className="bk-code">trade_decisions.paper</code>; the executor uses that snapshot so a
              mid-bar switch does not change past decisions.
            </p>
          </CardBody>
        </Card>
        <ExecutionModeForm initialMode={initialMode} />
      </Stack>
    </div>
  );
}
