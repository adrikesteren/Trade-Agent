import { LogsListView } from "@/app/(app)/object-tab-views/logs-list-view";
import { getObjectMetadataBySlug } from "@/lib/schema/object-registry";
import { notFound } from "next/navigation";

type PageProps = {
  params: Promise<{ tabSlug: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Tab-scoped list route. Objects with a dedicated static route (e.g. `/assets`) are still
 * served by those routes; registry-backed handlers (e.g. `logs`) render here once their
 * static folder is removed.
 */
export default async function TabSlugListPage({ params, searchParams }: PageProps) {
  const { tabSlug } = await params;
  const meta = getObjectMetadataBySlug(tabSlug);
  if (!meta) notFound();

  if (meta.slug === "logs") {
    return <LogsListView searchParams={searchParams} />;
  }

  notFound();
}
