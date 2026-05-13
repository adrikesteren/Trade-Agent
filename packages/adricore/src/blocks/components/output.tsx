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

type OutputBaseProps = {
  label: string;
  /** Raw display for non-lookup types (also used when `type` is `lookup` but no `lookup`/`record` yet). */
  value?: React.ReactNode;
  /** FK: absolute path + label for the related record. */
  lookup?: OutputLookup;
  /** Shorthand FK: `href` = `pathPrefix` + `/` + `id`. */
  record?: OutputRecordLink;
  /** Icon before lookup link (Salesforce-style). */
  lookupIcon?: "record" | "user" | "none";
  /** Span both columns inside `RecordPageGrid`. */
  span?: "full";
  className?: string;
};

export type OutputPropsDatetime = OutputBaseProps & {
  type: "datetime";
  /** App-injected formatter (user locale / timezone); required so `datetime` never uses browser-default locale silently. */
  formatDatetime: (v: string | number | Date) => string;
};

export type OutputPropsOther = OutputBaseProps & {
  type?: Exclude<OutputType, "datetime">;
  formatDatetime?: undefined;
};

export type OutputProps = OutputPropsDatetime | OutputPropsOther;

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

/** Plain string for `<pre><code>` (JSON metadata, ids, symbols). */
function stringifyCodeValue(value: React.ReactNode): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value == null) return "";
  return String(value);
}

function LookupGlyph({ kind }: { kind: "record" | "user" }) {
  const cls = "adri-output_lookup-icon";
  return kind === "user" ? <User className={cls} size={14} strokeWidth={2} aria-hidden /> : <Building2 className={cls} size={14} strokeWidth={2} aria-hidden />;
}

export function Output(props: OutputProps) {
  const { label, value, lookup, record, lookupIcon = "record", span, className } = props;
  const type: OutputType = props.type ?? "text";

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
      <span className="adri-output_lookup">
        {icon}
        <LinkText href={resolvedLookup.href}>{resolvedLookup.name}</LinkText>
      </span>
    );
  } else if (effectiveType === "boolean") {
    if (value === true || value === "true" || value === 1) body = "Yes";
    else if (value === false || value === "false" || value === 0) body = "No";
    else body = isEmptyValue(value) ? "—" : String(value);
  } else if (effectiveType === "datetime") {
    const fmt = props.type === "datetime" ? props.formatDatetime : null;
    if (!fmt) {
      throw new Error("Output: type datetime requires formatDatetime prop");
    }
    body = isEmptyValue(value) ? "—" : fmt(value as string | number | Date);
  } else if (effectiveType === "number") {
    body = isEmptyValue(value) ? "—" : typeof value === "number" ? String(value) : String(value);
  } else if (effectiveType === "empty") {
    body = "—";
  } else if (effectiveType === "codeblock") {
    body = isEmptyValue(value) ? (
      "—"
    ) : (
      <pre className="adri-output_pre">
        <code>{stringifyCodeValue(value)}</code>
      </pre>
    );
  } else {
    body = isEmptyValue(value) ? "—" : value;
  }

  return (
    <div className={cx("adri-output", span === "full" && "adri-output_span-full", className)}>
      <div className="adri-output_label">{label}</div>
      <div
        className={cx(
          "adri-output_value",
          effectiveType === "codeblock" && !isEmptyValue(value) && "adri-output_value_codeblock",
        )}
      >
        {body}
      </div>
    </div>
  );
}
