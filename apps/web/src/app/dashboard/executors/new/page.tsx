import { ExecutorForm, type AssetOption } from "@/app/dashboard/executors/executor-form";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Alert, PageHeader, Stack } from "@repo/blocks";
import Link from "next/link";
import { redirect } from "next/navigation";

async function fetchAssetOptions(supabase: SupabaseClient): Promise<AssetOption[]> {
  const { data, error } = await supabase
    .schema("catalog")
    .from("assets")
    .select("id, code")
    .eq("kind", "crypto")
    .order("code", { ascending: true })
    .limit(400);
  if (error) {
    console.error("assets list:", error.message);
    return [];
  }
  return ((data ?? []) as { id: string; code: string }[]).map((a) => ({ id: a.id, code: a.code }));
}

export default async function NewExecutorPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const assetOptions = await fetchAssetOptions(supabase);

  return (
    <div className="bk-container bk-container_lg bk-stack bk-stack_gap-md">
      <PageHeader
        title="New executor"
        subtitle="Create a portfolio with its own paper/live mode, optional asset whitelist or blacklist, then add EUR balance on the executor detail page."
      />
      <Stack gap="md">
        <p className="bk-text-muted text-sm">
          <Link href="/dashboard/executors" className="bk-link">
            Back to executors
          </Link>
        </p>
        {assetOptions.length === 0 ? (
          <Alert tone="warning">No catalog assets loaded yet; asset filters will be empty until assets exist.</Alert>
        ) : null}
        <ExecutorForm mode="create" assetOptions={assetOptions} />
      </Stack>
    </div>
  );
}
