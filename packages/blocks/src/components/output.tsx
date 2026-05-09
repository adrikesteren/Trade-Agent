import { Building2, User } from "lucide-react";
import * as React from "react";
import { cx } from "../lib/cx";
import { LinkText } from "./link";

/**
 * - `codeblock` — scrollable `<pre><code>` for JSON / long metadata blobs only.
 * Identifiers (record id, ticker “code”, symbols) use `type="text"` like any other field.
 */
export type OutputType = "text" | "lookup" | "datetime" | "boolean" | "number" | "codeblock" | "empty";

/** Linked foreign key / related record (detail URL + display name). */
export type OutputLookup = {
  href: string;
  name: string;
};

/** Build `href` as `{pathPrefix}/{id}` (slashes normalized). */
export type OutputRecordLink = {
  pathPrefix: string;
  id: string;
  name: string;
};

export type OutputProps = {
  label: string;
  type?: OutputType;
  /** Raw display for non-lookup types (also used when `type` is `lookup` but no `lookup`/`record` yet). */
  value?: React.ReactNode;
  /** FK: absolute path + label for the related record. */
  lookup?: OutputLookup;
  /** Shorthand FK: `href` = `pathPrefix` + `/` + `id`. */
  record?: OutputRecordLink;
  /** Icon before lookup link (Salesforce-style). */
  lookupIcon?: "record" | "user" | "none";
  /** Span both columns inside `RecordDetailGrid`. */
  span?: "full";
  className?: string;
};

function normalizeRecordHref(pathPrefix: string, id: string): string {
  const base = pathPrefix.replace(/\/+$/, "");
  return `${base}/${id}`;
}

function isEmptyValue(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === "boolean") return false;
  if (typeof v === "string" && v.trim() === "") return true;
  return false;
}

function formatDatetime(iso: string | number | Date): string {
  const d = typeof iso === "string" || typeof iso === "number" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** Plain string for `<pre><code>` (JSON metadata, ids, symbols). */
function stringifyCodeValue(value: React.ReactNode): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value == null) return "";
  return String(value);
}

function LookupGlyph({ kind }: { kind: "record" | "user" }) {
  const cls = "bk-output_lookup-icon";
  return kind === "user" ? <User className={cls} size={14} strokeWidth={2} aria-hidden /> : <Building2 className={cls} size={14} strokeWidth={2} aria-hidden />;
}

export function Output({
  label,
  type = "text",
  value,
  lookup,
  record,
  lookupIcon = "record",
  span,
  className,
}: OutputProps) {
  const resolvedLookup: OutputLookup | null = (() => {
    if (lookup?.href && lookup.name) return lookup;
    if (record?.id && record.name && record.pathPrefix) {
      return { href: normalizeRecordHref(record.pathPrefix, record.id), name: record.name };
    }
    return null;
  })();

  const showLookup = Boolean(resolvedLookup?.href && resolvedLookup.name);
  const effectiveType: OutputType = showLookup ? "lookup" : type;

  let body: React.ReactNode;
  if (showLookup && resolvedLookup) {
    const icon = lookupIcon !== "none" ? <LookupGlyph kind={lookupIcon === "user" ? "user" : "record"} /> : null;
    body = (
      <span className="bk-output_lookup">
        {icon}
        <LinkText href={resolvedLookup.href}>{resolvedLookup.name}</LinkText>
      </span>
    );
  } else if (effectiveType === "boolean") {
    if (value === true || value === "true" || value === 1) body = "Yes";
    else if (value === false || value === "false" || value === 0) body = "No";
    else body = isEmptyValue(value) ? "—" : String(value);
  } else if (effectiveType === "datetime") {
    body = isEmptyValue(value) ? "—" : formatDatetime(value as string | number | Date);
  } else if (effectiveType === "number") {
    body = isEmptyValue(value) ? "—" : typeof value === "number" ? String(value) : String(value);
  } else if (effectiveType === "empty") {
    body = "—";
  } else if (effectiveType === "codeblock") {
    body = isEmptyValue(value) ? (
      "—"
    ) : (
      <pre className="bk-output_pre">
        <code>{stringifyCodeValue(value)}</code>
      </pre>
    );
  } else {
    body = isEmptyValue(value) ? "—" : value;
  }

  return (
    <div className={cx("bk-output", span === "full" && "bk-output_span-full", className)}>
      <div className="bk-output_label">{label}</div>
      <div
        className={cx(
          "bk-output_value",
          effectiveType === "codeblock" && !isEmptyValue(value) && "bk-output_value_codeblock",
        )}
      >
        {body}
      </div>
    </div>
  );
}
