import * as React from "react";
import { AdriObjectMetadata } from "./adri-object-metadata";
import type { ObjectMetadata } from "./object-metadata";
import type { ObjectFieldMetadata, ColumnDef } from "./object-field-metadata";
import { ObjectRelationshipReferenceTypes } from "./enums";
import {
  TargetObjectIsRequiredException,
  SlugIsRequiredException,
  SourceObjectIsRequiredException,
  SourceFieldIsRequiredException,
} from "./exceptions";
import { Output, type OutputProps } from "../blocks/components/data-display/output";
import {
  RecordRelatedList,
  type RecordRelatedListProps,
} from "../blocks/patterns/record-page/record-related-list";

/** Pre-resolved related-record value for `Reference` lookup output. */
export type LookupValue = { id: string; name: string };

/** Options for `toRelatedListProps` / `CreateRelatedList`. */
export type RelatedListOpts<T> = {
  /** Override the rendered title. Defaults to `referenceObject.label.plural`. */
  title?: string;
  description?: React.ReactNode;
  /** Visible row cap (Salesforce default ~6). */
  previewLimit?: number;
  /** Total rows server-side (when the query was capped). */
  totalCount?: number;
  /** Empty-state message. */
  emptyMessage?: string;
  /** Override the View-all href. Defaults to `getRelatedListHref(parentId)`. */
  viewAllHref?: string;
  viewAllLabel?: string;
  alwaysShowViewAll?: boolean;
  actions?: React.ReactNode;
  /** Custom row renderer. When omitted, a default link to the related record's detail page is rendered. */
  renderRow?: (item: T) => React.ReactNode;
  /** Used by the default `renderRow` to extract the row id. Defaults to `item.id`. */
  getId?: (item: T) => string;
  /** Used by the default `renderRow` to extract the visible label. Defaults to `referenceObject.getRecordTitle(item)`. */
  getLabel?: (item: T) => string;
  className?: string;
};

export class ObjectRelationshipMetadata implements AdriObjectMetadata {
  public readonly apiName: string;
  public sourceObject?: ObjectMetadata;
  public readonly referenceObject: ObjectMetadata;
  public readonly referenceType: ObjectRelationshipReferenceTypes;
  public sourceField?: ObjectFieldMetadata;
  public allowTargetObjectDeletion: boolean = true;

  constructor(
    apiName: string,
    referenceType: ObjectRelationshipReferenceTypes,
    referenceObject: ObjectMetadata,
  ) {
    if (!referenceObject) {
      throw new TargetObjectIsRequiredException();
    } else if (!apiName || apiName.trim() === "") {
      throw new SlugIsRequiredException();
    }
    this.apiName = apiName;
    this.referenceType = referenceType;
    this.referenceObject = referenceObject;

    this.referenceObject.childRelationships.add(this);
  }

  public setSourceData(sourceObject: ObjectMetadata, sourceField: ObjectFieldMetadata): void {
    if (!sourceObject) {
      throw new SourceObjectIsRequiredException();
    } else if (!sourceField) {
      throw new SourceFieldIsRequiredException();
    }
    this.sourceObject = sourceObject;
    this.sourceField = sourceField;
  }

  public getApiName(): string {
    return this.apiName;
  }

  // ───────────────────── Routing ─────────────────────

  /**
   * Related-list URL on the **referenceObject** detail page:
   * `${referenceObject.route.href}/${parentId}/${apiName}`
   *
   * Mirrors the convention from `AGENTS.md`: `/{objectSlug}/{id}/{relatedSlug}`.
   * Example: `/executors/{id}/orders` for the `orders` child relationship.
   */
  public getRelatedListHref(parentId: string): string {
    const base = this.referenceObject.route.getRecordHref(parentId);
    return `${base}/${this.apiName}`;
  }

  // ───────────────────── Lookup output ─────────────────────

  /** Build `OutputProps` for a Salesforce-style lookup display (link + record icon). */
  public toLookupOutputProps(value: LookupValue, opts?: { label?: string }): OutputProps {
    const label = opts?.label ?? this.referenceObject.label.singular;
    return {
      label,
      type: "lookup",
      record: {
        pathPrefix: this.referenceObject.route.getHref(),
        id: value.id,
        name: value.name,
      },
    };
  }

  /** Render a Salesforce-style lookup output for a related record. */
  public CreateLookupOutput(value: LookupValue, opts?: { label?: string }): React.ReactNode {
    return <Output {...this.toLookupOutputProps(value, opts)} />;
  }

  // ───────────────────── Related list ─────────────────────

  /** Build `RecordRelatedListProps` for a Salesforce-style related list card. */
  public toRelatedListProps<T extends Record<string, unknown>>(
    parent: { id: string },
    rows: readonly T[],
    opts?: RelatedListOpts<T>,
  ): RecordRelatedListProps<T> {
    const refObj = this.referenceObject;
    const getId = opts?.getId ?? ((item) => String((item as { id?: unknown }).id ?? ""));
    const getLabel = opts?.getLabel ?? ((item) => refObj.getRecordTitle(item));

    return {
      title: opts?.title ?? refObj.label.plural,
      icon: refObj.CreateObjectIcon(),
      description: opts?.description,
      items: rows,
      getKey: getId,
      renderRow:
        opts?.renderRow ??
        ((item) => {
          const id = getId(item);
          const href = refObj.route.getRecordHref(id);
          return (
            <a href={href} className="bk-link">
              {getLabel(item)}
            </a>
          );
        }),
      previewLimit: opts?.previewLimit,
      totalCount: opts?.totalCount,
      emptyMessage: opts?.emptyMessage,
      viewAllHref: opts?.viewAllHref ?? this.getRelatedListHref(parent.id),
      viewAllLabel: opts?.viewAllLabel,
      alwaysShowViewAll: opts?.alwaysShowViewAll,
      actions: opts?.actions,
      className: opts?.className,
    };
  }

  /** Render a Salesforce-style related list card for the given parent + rows. */
  public CreateRelatedList<T extends Record<string, unknown>>(
    parent: { id: string },
    rows: readonly T[],
    opts?: RelatedListOpts<T>,
  ): React.ReactNode {
    return <RecordRelatedList<T> {...this.toRelatedListProps(parent, rows, opts)} />;
  }

  // ───────────────────── Default columns ─────────────────────

  /** Convenience: default columns for the related list table (delegates to `referenceObject`). */
  public CreateColumns(fieldApiNames?: string[]): ColumnDef[] {
    return this.referenceObject.toColumns(fieldApiNames);
  }
}
