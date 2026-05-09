import { createClient } from "@/lib/supabase/server";
import {
  Alert,
  Card,
  CardBody,
  ListViewObjectIcon,
  ListViewPlaceholderToolbar,
  ListViewTitlePickerPlaceholder,
  PageHeader,
  Table,
  TableWrap,
  Td,
  Th,
  listViewOutlineActionClass,
} from "@repo/blocks";
import Link from "next/link";

export default async function ExchangesIndexPage() {
  const supabase = await createClient();

  const { data: rows, error } = await supabase
    .schema("catalog")
    .from("exchanges")
    .select("id, code, name")
    .order("code", { ascending: true })
    .limit(500);

  const list = rows ?? [];
  const n = list.length;
  const summaryBits = [`${n} exchange${n === 1 ? "" : "s"}`, "Sorted by Code", "Max 500 rows"];

  return (
    <div className="bk-container bk-container_lg bk-stack bk-stack_gap-md">
      <PageHeader
        variant="list"
        icon={<ListViewObjectIcon letter="E" />}
        eyebrow="Exchanges"
        title="Directory"
        titleAddon={<ListViewTitlePickerPlaceholder />}
        subtitle={
          <>
            Venues that host{" "}
            <Link href="/dashboard/markets" className="bk-link">
              markets
            </Link>{" "}
            (catalog reference data).
          </>
        }
        summary={summaryBits.join(" · ")}
        toolbar={<ListViewPlaceholderToolbar />}
        actions={
          <Link href="/dashboard" className={listViewOutlineActionClass}>
            Dashboard
          </Link>
        }
      />

      {error ? <Alert tone="error">{error.message}</Alert> : null}

      <Card>
        <CardBody className="!pt-0">
          <TableWrap>
            <Table className="text-xs">
              <thead>
                <tr>
                  <Th>Name</Th>
                  <Th>Code</Th>
                </tr>
              </thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.id}>
                    <Td>
                      <Link href={`/dashboard/exchanges/${r.id}`} className="bk-link">
                        {r.name?.trim() ? r.name : r.code}
                      </Link>
                    </Td>
                    <Td className="font-mono">{r.code}</Td>
                  </tr>
                ))}
                {!list.length ? (
                  <tr>
                    <Td colSpan={2} muted className="py-8 text-center">
                      No exchanges in the database yet.
                    </Td>
                  </tr>
                ) : null}
              </tbody>
            </Table>
          </TableWrap>
        </CardBody>
      </Card>
    </div>
  );
}
