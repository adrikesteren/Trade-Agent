import * as React from "react";
import { AdriObjectMetadata } from "./adri-object-metadata";
import { ObjectLabelMetadata } from "./object-label-metadata";
import { IconMetadata } from "./icon-metadata";
import { RouteMetadata } from "./route-metadata";
import { ObjectFieldMetadataRegistry, ObjectRelationshipMetadataRegistry } from "./registries";
import { standardObjectFieldRegistry } from "./standard-fields";
import type { ColumnDef, FieldOutputOpts } from "./object-field-metadata";
import {
  SchemaIsRequiredException,
  TableIsRequiredException,
  ApiNameIsRequiredException,
  LabelIsRequiredException,
  IconIsRequiredException,
} from "./exceptions";
import { PageHeader } from "../blocks/patterns/page-header/page-header";
import type { PageHeaderProps } from "../blocks/patterns/page-header/types";
import { ListViewObjectIcon } from "../blocks/components/data-display/object-icon";
import { Breadcrumbs, type Crumb } from "../blocks/components/layout/breadcrumbs";

/** NameFieldSpec kept for backwards compatibility with UI */
export type NameFieldSpec =
  | { mode: "manual" }
  | { mode: "autoNumber"; displayFormat: string; startNumber?: number };

/** Apinames of fields auto-cloned from `standardObjectFieldRegistry`. Excluded from default columns. */
const SYSTEM_FIELD_API_NAMES = new Set<string>(["id", "created_by", "created_at", "updated_by", "updated_at"]);

/** Options for `ObjectMetadata.toListPageHeaderProps` / `CreateListPageHeader`. */
export type ListHeaderOpts = {
  /** Total rows currently loaded (after Supabase paging). */
  rowCount: number;
  /** Sort line summary, e.g. `Sorted by Created At` */
  sortLine?: string;
  /** Override summary line entirely. When omitted it is derived from `rowCount`/`sortLine`/`maxRows`. */
  summary?: React.ReactNode;
  actions?: React.ReactNode;
  /** When true, the summary omits the "Max N rows" segment (unbounded list). */
  uncapped?: boolean;
  /** Ceiling that should be reflected in the summary. */
  maxRows?: number;
  /** Title-row addon (e.g. list-view picker chevron). */
  titleAddon?: React.ReactNode;
  /** Bottom toolbar row (search + icon controls). */
  toolbar?: React.ReactNode;
  /** Override letter rendered inside the object icon (defaults to first letter of singular label). */
  iconLetter?: string;
  /** Override the entire icon node. */
  icon?: React.ReactNode;
  /** Override the auto-derived title (default: `label.plural`). Use for list-view names. */
  title?: React.ReactNode;
  /** Optional subtitle / description rendered under the title row. */
  subtitle?: React.ReactNode;
  className?: string;
};

/** Options for `ObjectMetadata.toDetailPageHeaderProps` / `CreateDetailPageHeader`. */
export type DetailHeaderOpts = {
  /** The record being shown. Used to derive the title via `getRecordTitle`. */
  record: Record<string, unknown>;
  /** Override the auto-derived title. */
  title?: React.ReactNode;
  /** Extra classes on the `<h1>` (e.g. `font-mono` for ID-like titles). */
  titleClassName?: string;
  actions?: React.ReactNode;
  highlights?: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Override the entire icon node. */
  icon?: React.ReactNode;
  /** Override the icon letter. */
  iconLetter?: string;
  className?: string;
};

export type ObjectIconOpts = {
  /** Override the rendered letter (defaults to first letter of `label.singular`). */
  letter?: string;
  className?: string;
};

export abstract class ObjectMetadata implements AdriObjectMetadata {
  public readonly schema: string;
  public readonly table: string;
  public readonly apiName: string;
  public readonly label: ObjectLabelMetadata;
  public readonly icon: IconMetadata;
  public readonly route: RouteMetadata;
  public readonly fieldRegistry: ObjectFieldMetadataRegistry;
  public readonly childRelationships: ObjectRelationshipMetadataRegistry =
    new ObjectRelationshipMetadataRegistry();

  /**
   * Optional properties carried over for UI and routing compatibility
   */
  public idColumn?: string;
  public slug?: string;
  public nameField?: NameFieldSpec;

  constructor(
    schema: string,
    table: string,
    apiName: string,
    label: ObjectLabelMetadata,
    icon: IconMetadata,
  ) {
    if (!schema || schema.trim() === "") {
      throw new SchemaIsRequiredException();
    } else if (!table || table.trim() === "") {
      throw new TableIsRequiredException();
    } else if (!apiName || apiName.trim() === "") {
      throw new ApiNameIsRequiredException();
    } else if (!label) {
      throw new LabelIsRequiredException();
    } else if (!icon) {
      throw new IconIsRequiredException();
    }

    this.schema = schema;
    this.table = table;
    this.apiName = apiName;
    this.label = label;
    this.icon = icon;

    this.route = new RouteMetadata(this.icon, `/${apiName}`, this.label.plural);

    this.slug = apiName;
    this.idColumn = "id";

    this.fieldRegistry = standardObjectFieldRegistry.clone(this);
  }

  public getApiName(): string {
    return this.apiName;
  }

  /**
   * Override this method in subclasses to set up relationships.
   * This is called by the ObjectMetadataRegistry during initialization.
   */
  public connectRelationships(): void {
    // Default implementation does nothing
  }

  // ───────────────────── Routing helpers ─────────────────────

  /** Absolute href for a record on this object: `${route.href}/${recordId}`. */
  public getDetailHref(recordId: string): string {
    return this.route.getRecordHref(recordId);
  }

  /**
   * Resolve the display title for a record.
   *
   * Honors `nameField`:
   * - `manual` (or undefined) → `record.name`
   * - `autoNumber` → `record.name` (already pre-formatted by DB)
   *
   * Falls back to `record.id` then `""`.
   */
  public getRecordTitle(record: Record<string, unknown>): string {
    if (record == null) return "";
    const name = record["name"];
    if (typeof name === "string" && name.trim() !== "") return name;
    if (name !== undefined && name !== null) return String(name);
    const id = record["id"];
    if (id !== undefined && id !== null) return String(id);
    return "";
  }

  // ───────────────────── Object icon ─────────────────────

  /** Render the Lightning-style object icon (rounded gradient square + letter). */
  public CreateObjectIcon(opts?: ObjectIconOpts): React.ReactNode {
    const letter = opts?.letter ?? this.label.singular.trim().slice(0, 1).toUpperCase();
    return <ListViewObjectIcon letter={letter} className={opts?.className} />;
  }

  // ───────────────────── List view header ─────────────────────

  /** Pure descriptor for `<PageHeader variant="list">` driven by this object's metadata. */
  public toListPageHeaderProps(opts: ListHeaderOpts): PageHeaderProps {
    const n = opts.rowCount;
    const summary =
      opts.summary !== undefined
        ? opts.summary
        : (() => {
            const parts = [`${n} row${n === 1 ? "" : "s"}`];
            if (opts.sortLine) parts.push(opts.sortLine);
            if (!opts.uncapped) parts.push(`Max ${opts.maxRows ?? 200} rows`);
            return parts.join(" · ");
          })();

    const icon = opts.icon ?? this.CreateObjectIcon({ letter: opts.iconLetter });

    return {
      variant: "list",
      icon,
      title: opts.title ?? this.label.plural,
      subtitle: opts.subtitle,
      titleAddon: opts.titleAddon,
      summary,
      toolbar: opts.toolbar,
      actions: opts.actions,
      className: opts.className,
    };
  }

  /** Render `<PageHeader variant="list">` for this object. */
  public CreateListPageHeader(opts: ListHeaderOpts): React.ReactNode {
    return <PageHeader {...this.toListPageHeaderProps(opts)} />;
  }

  // ───────────────────── Detail page header ─────────────────────

  /** Pure descriptor for `<PageHeader variant="detail">` driven by this object's metadata + record. */
  public toDetailPageHeaderProps(opts: DetailHeaderOpts): PageHeaderProps {
    const title = opts.title ?? this.getRecordTitle(opts.record);
    const icon = opts.icon ?? this.CreateObjectIcon({ letter: opts.iconLetter });

    return {
      variant: "detail",
      icon,
      title,
      titleClassName: opts.titleClassName,
      subtitle: opts.subtitle,
      actions: opts.actions,
      highlights: opts.highlights,
      className: opts.className,
    };
  }

  /** Render `<PageHeader variant="detail">` for this object + record. */
  public CreateDetailPageHeader(opts: DetailHeaderOpts): React.ReactNode {
    return <PageHeader {...this.toDetailPageHeaderProps(opts)} />;
  }

  // ───────────────────── Breadcrumb / row link ─────────────────────

  /**
   * Render a `<Breadcrumbs>` rooted at this object's list view.
   * When `record` is supplied, the trailing crumb is the record title (no link).
   */
  public CreateBreadcrumb(opts?: { record?: Record<string, unknown>; extra?: Crumb[] }): React.ReactNode {
    const items: Crumb[] = [{ label: this.label.plural, href: this.route.getHref() }];
    if (opts?.extra) items.push(...opts.extra);
    if (opts?.record) {
      items.push({ label: this.getRecordTitle(opts.record) });
    }
    return <Breadcrumbs items={items} />;
  }

  /** Render an anchor pointing at the detail page for a record. */
  public CreateRowLink(record: Record<string, unknown>): React.ReactNode {
    const id = record["id"];
    if (id === undefined || id === null || id === "") {
      return <span>{this.getRecordTitle(record)}</span>;
    }
    const href = this.getDetailHref(String(id));
    return (
      <a href={href} className="bk-link">
        {this.getRecordTitle(record)}
      </a>
    );
  }

  // ───────────────────── Columns ─────────────────────

  /**
   * Build column descriptors for this object's fields.
   *
   * @param fieldApiNames When omitted, returns columns for every field except
   *                      system fields (id, created_at, created_by, updated_at,
   *                      updated_by). When supplied, returns columns in that
   *                      exact order.
   */
  public toColumns(fieldApiNames?: string[]): ColumnDef[] {
    if (fieldApiNames && fieldApiNames.length > 0) {
      const cols: ColumnDef[] = [];
      for (const apiName of fieldApiNames) {
        const f = this.fieldRegistry.registrations.get(apiName);
        if (f) cols.push(f.toColumnDef());
      }
      return cols;
    }

    const all = Array.from(this.fieldRegistry.registrations.values());
    return all
      .filter((f) => !SYSTEM_FIELD_API_NAMES.has(f.apiName))
      .map((f) => f.toColumnDef());
  }

  /** Alias of `toColumns`; kept for naming symmetry with `Create*` methods. */
  public CreateColumns(fieldApiNames?: string[]): ColumnDef[] {
    return this.toColumns(fieldApiNames);
  }

  // ───────────────────── Convenience: render a single field of a record ─────────────────────

  /**
   * Shortcut: render `<Output>` for `record[fieldApiName]`. Looks the field up in
   * `fieldRegistry`. Returns `null` when the field is not registered.
   */
  public CreateFieldOutput(
    record: Record<string, unknown>,
    fieldApiName: string,
    opts?: FieldOutputOpts,
  ): React.ReactNode {
    const field = this.fieldRegistry.registrations.get(fieldApiName);
    if (!field) return null;
    return field.CreateOutput(record[fieldApiName], opts);
  }
}
