import { ObjectLabelMetadata } from "./object-label-metadata";
import { IconMetadata } from "./icon-metadata";
import { ObjectFieldMetadata } from "./object-field-metadata";
import { ObjectFieldDataTypes } from "./enums";
import { ObjectMetadataBase } from "./object-metadata-base";

export type {
  ListHeaderOpts,
  DetailHeaderOpts,
  ObjectIconOpts,
} from "./object-metadata-base";

/**
 * How the row's `name` column is filled.
 *
 * - `manual` — user supplies the name (default behavior).
 * - `autoNumber` — DB trigger fills the name from a sequence using `displayFormat`
 *   (e.g. `"ORD-{0000}"`). Changing the format requires a new SQL migration that
 *   replaces the trigger function; old rows keep their old names.
 * - `formula` — DB trigger derives the name from other columns or joined rows
 *   (e.g. Markets: `base_code + "-" + quote_code`). Optional JS `compute` is used
 *   as a UI fallback when the DB-derived `record.name` is missing.
 */
export type NameFieldSpec =
  | { mode: "manual" }
  | { mode: "autoNumber"; displayFormat: string; startNumber?: number }
  | {
      mode: "formula";
      description: string;
      compute?: (record: Record<string, unknown>) => string;
    };

/**
 * Object metadata for user-facing rows.
 *
 * Inherits the standard audit field set (`id`, `created_by`, `created_at`,
 * `updated_by`, `updated_at`) from {@link ObjectMetadataBase} and adds a
 * standard `name` column plus a {@link NameFieldSpec} that documents how that
 * column is populated.
 */
export abstract class ObjectMetadata extends ObjectMetadataBase {
  public nameField?: NameFieldSpec;

  constructor(
    schema: string,
    table: string,
    apiName: string,
    label: ObjectLabelMetadata,
    icon: IconMetadata,
  ) {
    super(schema, table, apiName, label, icon);
    this.fieldRegistry.add(
      new ObjectFieldMetadata("name", "Name", ObjectFieldDataTypes.String, {
        required: true,
        sourceObject: this,
      }),
    );
  }

  /**
   * Resolve the display title for a record.
   *
   * Honors {@link NameFieldSpec}:
   * - `manual` (or undefined) → `record.name` (user-supplied).
   * - `autoNumber` → `record.name` (DB trigger pre-formatted it from the per-table sequence).
   * - `formula` → `record.name` (DB trigger pre-computed it); if missing, the
   *   optional JS `compute` is evaluated as a UI fallback.
   *
   * Falls back to `record.id` then `""`.
   */
  public override getRecordTitle(record: Record<string, unknown>): string {
    if (record == null) return "";
    const name = record["name"];
    if (typeof name === "string" && name.trim() !== "") return name;
    if (name !== undefined && name !== null && name !== "") return String(name);
    if (this.nameField?.mode === "formula" && typeof this.nameField.compute === "function") {
      try {
        const computed = this.nameField.compute(record);
        if (typeof computed === "string" && computed.trim() !== "") return computed;
      } catch {
        // fall through to id fallback below
      }
    }
    const id = record["id"];
    if (id !== undefined && id !== null) return String(id);
    return "";
  }
}
