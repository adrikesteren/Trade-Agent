import * as React from "react";
import { Building2, User } from "lucide-react";
import { cx } from "../../lib/cx";
import { LinkText } from "../actions/link";

/**
 * Output types — read-only "stat / field" display:
 * - `text` / default — any identifier, code, ticker, free-text value.
 * - `number` — numeric value (right-alignment is up to the caller).
 * - `boolean` — Yes / No.
 * - `datetime` — requires `formatDatetime` (locale/tz-aware).
 * - `lookup` — linked foreign key (renders `lookup` or `record` icon + name).
 * - `codeblock` — JSON / long metadata in a scrollable `<pre><code>`.
 * - `empty` — explicit placeholder.
 */
export type OutputType = "text" | "lookup" | "datetime" | "boolean" | "number" | "codeblock" | "empty";

/** Linked foreign-key record (absolute URL + display name). */
export type OutputLookup = {
  href: string;
  name: string;
};

/** Shorthand: builds `href` as `{pathPrefix}/{id}` (slashes normalised). */
export type OutputRecordLink = {
  pathPrefix: string;
  id: string;
  name: string;
};

type OutputBaseProps = {
  label: string;
  /** Raw display value for non-lookup types. */
  value?: React.ReactNode;
  /** FK: absolute path + label for the related record. */
  lookup?: OutputLookup;
  /** Shorthand FK: `href` = `pathPrefix` + `/` + `id`. */
  record?: OutputRecordLink;
  /** Icon shown before lookup link. Defaults to "record". */
  lookupIcon?: "record" | "user" | "none";
  /** Span both columns inside `RecordPageGrid`. */
  span?: "full";
  className?: string;
};

export type OutputPropsDatetime = OutputBaseProps & {
  type: "datetime";
  /** App-injected formatter (user locale / timezone). */
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

function stringifyCodeValue(value: React.ReactNode): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value == null) return "";
  return String(value);
}

function LookupGlyph({ kind }: { kind: "record" | "user" }) {
  const cls = "bk-output_lookup-icon";
  return kind === "user" ? (
    <User className={cls} size={14} strokeWidth={2} aria-hidden />
  ) : (
    <Building2 className={cls} size={14} strokeWidth={2} aria-hidden />
  );
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
    const fmt = props.type === "datetime" ? props.formatDatetime : null;
    if (!fmt) {
      throw new Error("Output: type datetime requires formatDatetime prop");
    }
    body = isEmptyValue(value) ? "—" : fmt(value as string | number | Date);
  } else if (effectiveType === "number") {
    body = isEmptyValue(value) ? "—" : String(value);
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
