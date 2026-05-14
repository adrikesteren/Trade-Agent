import { LogsDetailView } from "@/app/(app)/object-tab-views/logs-detail-view";
import { getObjectMetadataBySlug } from "@/lib/objects/registry";
import { notFound } from "next/navigation";

type PageProps = { params: Promise<{ tabSlug: string; recordId: string }> };

export default async function TabSlugRecordPage({ params }: PageProps) {
  const { tabSlug, recordId } = await params;
  const meta = getObjectMetadataBySlug(tabSlug);
  if (!meta) notFound();

  if (meta.slug === "logs") {
    return <LogsDetailView recordId={recordId} />;
  }

  notFound();
}
