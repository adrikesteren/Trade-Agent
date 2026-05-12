import {
  buildListPageHref,
  clampPage,
  defaultListPageSize,
  totalPages,
} from "@/lib/dashboard/list-pagination";
import Link from "next/link";

export type ListViewPaginationProps = {
  pathname: string;
  page: number;
  pageSize?: number;
  totalCount: number;
  /** Preserved query keys (e.g. executorId, orderId); never pass `page`. */
  extraQuery?: Record<string, string | undefined>;
};

function navClass(disabled: boolean): string {
  return disabled
    ? "bk-text-muted pointer-events-none cursor-default text-sm"
    : "bk-link text-sm font-medium";
}

export function ListViewPagination({
  pathname,
  page: pageRaw,
  pageSize = defaultListPageSize(),
  totalCount,
  extraQuery = {},
}: ListViewPaginationProps) {
  const pages = totalPages(totalCount, pageSize);
  const page = clampPage(pageRaw, pages);
  const start = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, totalCount);

  const prevPage = page - 1;
  const nextPage = page + 1;
  const hasPrev = page > 1;
  const hasNext = page < pages;

  return (
    <nav
      className="flex flex-wrap items-center justify-between gap-2 border border-[var(--bk-border)] bg-[var(--bk-surface-1)] px-3 py-2 text-xs"
      aria-label="Table pagination"
    >
      <span className="bk-text-muted">
        {totalCount === 0 ? (
          "No rows"
        ) : (
          <>
            Showing <span className="font-mono text-[var(--text)]">{start}</span>–
            <span className="font-mono text-[var(--text)]">{end}</span> of{" "}
            <span className="font-mono text-[var(--text)]">{totalCount}</span>
          </>
        )}
      </span>
      <div className="flex flex-wrap items-center gap-3">
        <span className="bk-text-muted">
          Page <span className="font-mono text-[var(--text)]">{page}</span> of{" "}
          <span className="font-mono text-[var(--text)]">{pages}</span>
        </span>
        <span className="flex items-center gap-2">
          {hasPrev ? (
            <Link href={buildListPageHref(pathname, prevPage, extraQuery)} className={navClass(false)} prefetch={false}>
              Previous
            </Link>
          ) : (
            <span className={navClass(true)}>Previous</span>
          )}
          {hasNext ? (
            <Link href={buildListPageHref(pathname, nextPage, extraQuery)} className={navClass(false)} prefetch={false}>
              Next
            </Link>
          ) : (
            <span className={navClass(true)}>Next</span>
          )}
        </span>
      </div>
    </nav>
  );
}
