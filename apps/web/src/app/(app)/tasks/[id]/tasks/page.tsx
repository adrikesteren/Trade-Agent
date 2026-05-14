import { ObjectListViewHeader } from "@/components/object-list-view-header";
import { formatDatetime } from "@/lib/locale/format";
import { getUserLocalePreferences } from "@/lib/locale/get-user-locale-preferences";
import { objectRegistry } from "@/lib/objects/registry";
import { createClient } from "@/lib/supabase/server";
import {
  Alert,
  Card,
  CardBody,
  ListViewLayout,
  Table,
  TableWrap,
  Td,
  Th,
} from "@repo/adricore/blocks";
import Link from "next/link";
import { notFound } from "next/navigation";

type PageProps = { params: Promise<{ id: string }> };

function isUuidLike(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s.trim());
}

export default async function TaskSubtasksPage({ params }: PageProps) {
  const { id } = await params;
  if (!isUuidLike(id)) notFound();

  const supabase = await createClient();
  const prefs = await getUserLocalePreferences();
  const formatDt = (v: string | number | Date) => formatDatetime(v, prefs);

  const { data: parent, error: pErr } = await supabase.from("tasks").select("id, title").eq("id", id).maybeSingle();

  if (pErr || !parent) notFound();

  const { data: rows, error } = await supabase
    .from("tasks")
    .select("id, title, status, task_type, created_at")
    .eq("parent_task_id", id)
    .order("created_at", { ascending: false });

  const list = rows ?? [];

  return (
    <ListViewLayout className="bk-container bk-container_lg bk-stack bk-stack_gap-md">
      <ObjectListViewHeader
        model={objectRegistry.registrations.get("tasks")!}
        title="Subtasks"
        rowCount={list.length}
        sortLine="Created (newest first)"
        uncapped
        actions={
          <Link href={`/tasks/${id}`} className="bk-link text-sm">
            ← {(parent as { title?: string }).title ?? "Parent task"}
          </Link>
        }
      />

      {error ? <Alert tone="error">{error.message}</Alert> : null}

      <Card>
        <CardBody className="!pt-0">
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>Title</Th>
                  <Th>Status</Th>
                  <Th>Type</Th>
                  <Th>Created</Th>
                </tr>
              </thead>
              <tbody>
                {list.map((t) => (
                  <tr key={t.id}>
                    <Td>
                      <Link href={`/tasks/${t.id}`} className="bk-link font-medium">
                        {(t as { title: string }).title}
                      </Link>
                    </Td>
                    <Td>
                      <span className="font-mono text-xs">{(t as { status: string }).status}</span>
                    </Td>
                    <Td>
                      <span className="font-mono text-xs">{(t as { task_type: string }).task_type}</span>
                    </Td>
                    <Td className="whitespace-nowrap text-xs">{formatDt((t as { created_at: string }).created_at)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        </CardBody>
      </Card>
    </ListViewLayout>
  );
}
