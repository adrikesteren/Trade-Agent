import { ObjectListViewHeader } from "@/components/object-list-view-header";
import { formatDatetime } from "@/lib/locale/format";
import { getUserLocalePreferences } from "@/lib/locale/get-user-locale-preferences";
import { objectRegistry } from "@/lib/objects/registry";
import * as TasksSelector from "@/lib/selectors/tasks-selector";
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
} from "@adrikesteren/adricore/blocks";
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

  let parent: Awaited<ReturnType<typeof TasksSelector.selectIdAndTitleById>>;
  try {
    parent = await TasksSelector.selectIdAndTitleById(supabase, id);
  } catch {
    notFound();
  }
  if (!parent) notFound();

  let list: Awaited<ReturnType<typeof TasksSelector.selectSubtasksByParentId>> = [];
  let error: { message: string } | null = null;
  try {
    list = await TasksSelector.selectSubtasksByParentId(supabase, { parentId: id });
  } catch (e) {
    error = { message: e instanceof Error ? e.message : String(e) };
  }

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
            ← {parent.title ?? "Parent task"}
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
                        {t.title}
                      </Link>
                    </Td>
                    <Td>
                      <span className="font-mono text-xs">{t.status}</span>
                    </Td>
                    <Td>
                      <span className="font-mono text-xs">{t.task_type}</span>
                    </Td>
                    <Td className="whitespace-nowrap text-xs">{formatDt(t.created_at)}</Td>
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
