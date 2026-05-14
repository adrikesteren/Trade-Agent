import * as React from "react";
import { AdriObjectMetadata } from "./adri-object-metadata";
import { ObjectFieldDataTypes } from "./enums";
import type { ObjectMetadataBase } from "./object-metadata-base";
import type { ObjectRelationshipMetadata } from "./object-relationship-metadata";
import type { PicklistMetadata } from "./picklist-metadata";
import {
  ObjectRelationshipMetadataIsRequiredException,
  SourceObjectIsRequiredException,
  PicklistOptionsIsRequiredException,
  PicklistOptionsRequireAtleastOneException,
} from "./exceptions";
import {
  Output,
  type OutputProps,
  type OutputType,
} from "../blocks/components/data-display/output";
import { Input } from "../blocks/components/forms/input";
import { Select } from "../blocks/components/forms/select";
import { Checkbox } from "../blocks/components/forms/checkbox";
import { FormElement } from "../blocks/components/forms/form-element";
import { Lookup } from "../blocks/components/forms/lookup";

export interface ObjectFieldMetadataOptions {
  readOnly?: boolean;
  required?: boolean;
  relationship?: ObjectRelationshipMetadata;
  picklist?: PicklistMetadata;
  sourceObject?: ObjectMetadataBase;
}

/**
 * Options for `ObjectFieldMetadata.toOutputProps` / `CreateOutput`.
 *
 * The `record` shape is used for `Reference` fields when the parent query joined
 * the related row (e.g. `select=…, related:related_table(id, name)`). When omitted,
 * the metadata falls back to the raw `value`.
 */
export type FieldOutputOpts = {
  /** App-injected datetime formatter (locale + timezone). Required for Date / Datetime fields. */
  formatDatetime?: (v: string | number | Date) => string;
  /** Pre-resolved related record for `Reference` fields. */
  record?: { id: string; name: string };
  /** Span both columns inside `RecordPageGrid`. */
  span?: "full";
  className?: string;
};

/**
 * Discriminator describing which AdriCore form control is the right fit for an
 * input on this field. Used by both `toInputProps` (data-only descriptor) and
 * `CreateInput` (JSX wrapper).
 */
export type FieldInputKind =
  | "checkbox"
  | "select"
  | "lookup"
  | "input-text"
  | "input-number"
  | "input-date"
  | "input-datetime";

/**
 * Pure descriptor of an input bound to this field. Suitable for any renderer
 * (web, RN, …). The `value` and `error` flow with the descriptor; the `onChange`
 * callback is supplied separately when the control is actually rendered.
 */
export type FieldInputDescriptor = {
  kind: FieldInputKind;
  id: string;
  label: string;
  required: boolean;
  readOnly: boolean;
  value: unknown;
  /** Picklist options (kind === "select"). */
  options?: { value: string; label: string; isDefault?: boolean }[];
  /** Reference / Lookup binding (kind === "lookup"). */
  relationship?: ObjectRelationshipMetadata;
  error?: string;
};

export type FieldInputOpts = {
  /** Validation error string surfaced beneath the control. */
  error?: string;
};

/**
 * Column descriptor produced by `ObjectFieldMetadata.toColumnDef` /
 * `ObjectMetadata.toColumns`. Tables iterate over these to render headers and
 * cells; `renderCell` delegates back to `field.CreateOutput`.
 */
export type ColumnDef = {
  field: ObjectFieldMetadata;
  /** Same as `field.apiName`. */
  key: string;
  /** Same as `field.label`. */
  label: string;
  renderCell: (record: Record<string, unknown>, opts?: FieldOutputOpts) => React.ReactNode;
};

export class ObjectFieldMetadata implements AdriObjectMetadata {
  public sourceObject?: ObjectMetadataBase;
  public readonly apiName: string;
  public readonly label: string;
  public readonly readOnly: boolean;
  public readonly required: boolean;
  public readonly dataType: ObjectFieldDataTypes;
  public picklist?: PicklistMetadata;
  public relationship?: ObjectRelationshipMetadata;

  constructor(
    apiName: string,
    label: string,
    dataType: ObjectFieldDataTypes,
    options?: ObjectFieldMetadataOptions,
  ) {
    this.readOnly = options?.readOnly ?? false;
    this.required = options?.required ?? false;

    switch (dataType) {
      case ObjectFieldDataTypes.Reference:
        if (!options?.relationship) {
          throw new ObjectRelationshipMetadataIsRequiredException();
        } else if (!options?.sourceObject) {
          throw new SourceObjectIsRequiredException();
        }

        this.relationship = options.relationship;
        this.relationship.setSourceData(options.sourceObject, this);
        break;

      case ObjectFieldDataTypes.Picklist:
      case ObjectFieldDataTypes.MultiPicklist:
        if (!options?.picklist) {
          throw new PicklistOptionsIsRequiredException();
        } else if (options.picklist.options.size === 0) {
          throw new PicklistOptionsRequireAtleastOneException();
        }

        this.picklist = options.picklist;
        break;
    }

    this.sourceObject = options?.sourceObject;
    this.apiName = apiName;
    this.label = label;
    this.dataType = dataType;
  }

  public getApiName(): string {
    return this.apiName;
  }

  public clone(sourceObject: ObjectMetadataBase): ObjectFieldMetadata {
    if (!sourceObject) {
      throw new SourceObjectIsRequiredException();
    }
    const clonedField = new ObjectFieldMetadata(this.apiName, this.label, this.dataType, {
      readOnly: this.readOnly,
      required: this.required,
      relationship: this.relationship,
      picklist: this.picklist,
      sourceObject: sourceObject,
    });
    return clonedField;
  }

  // ───────────────────── Output (read-only display) ─────────────────────

  /**
   * Build pure `OutputProps` for the AdriCore `Output` block. Platform-neutral:
   * a future React Native renderer can consume this descriptor directly.
   *
   * Salesforce parallel: `lightning-formatted-*` chosen automatically based on
   * field metadata.
   */
  public toOutputProps(value: unknown, opts?: FieldOutputOpts): OutputProps {
    const baseProps = {
      label: this.label,
      span: opts?.span,
      className: opts?.className,
    } as const;

    switch (this.dataType) {
      case ObjectFieldDataTypes.Boolean:
        return { ...baseProps, type: "boolean", value: value as React.ReactNode };

      case ObjectFieldDataTypes.Integer:
      case ObjectFieldDataTypes.Decimal:
        return { ...baseProps, type: "number", value: value as React.ReactNode };

      case ObjectFieldDataTypes.Code:
        return { ...baseProps, type: "codeblock", value: value as React.ReactNode };

      case ObjectFieldDataTypes.Date:
      case ObjectFieldDataTypes.Datetime: {
        if (!opts?.formatDatetime) {
          // Fall back to raw text so callers without a formatter still render something
          return { ...baseProps, type: "text", value: value as React.ReactNode };
        }
        return {
          ...baseProps,
          type: "datetime",
          value: value as React.ReactNode,
          formatDatetime: opts.formatDatetime,
        };
      }

      case ObjectFieldDataTypes.Reference: {
        const refObj = this.relationship?.referenceObject;
        const pathPrefix = refObj?.route.getHref() ?? "";
        const pre = opts?.record;
        if (pre && pre.id && pre.name) {
          return {
            ...baseProps,
            type: "lookup",
            record: { pathPrefix, id: pre.id, name: pre.name },
          };
        }
        if (typeof value === "object" && value !== null && "id" in value && "name" in value) {
          const v = value as { id: unknown; name: unknown };
          return {
            ...baseProps,
            type: "lookup",
            record: { pathPrefix, id: String(v.id), name: String(v.name) },
          };
        }
        if (value !== null && value !== undefined && value !== "") {
          const id = String(value);
          return {
            ...baseProps,
            type: "lookup",
            record: { pathPrefix, id, name: id },
          };
        }
        return { ...baseProps, type: "empty", value: undefined };
      }

      case ObjectFieldDataTypes.Picklist:
      case ObjectFieldDataTypes.MultiPicklist: {
        if (this.picklist) {
          const option = this.picklist.options.get(String(value));
          return { ...baseProps, type: "text", value: option ? option.label : (value as React.ReactNode) };
        }
        return { ...baseProps, type: "text", value: value as React.ReactNode };
      }

      case ObjectFieldDataTypes.Email:
      case ObjectFieldDataTypes.Phone:
      case ObjectFieldDataTypes.Url:
      case ObjectFieldDataTypes.Id:
      case ObjectFieldDataTypes.String:
      case ObjectFieldDataTypes.TextArea:
      default: {
        const t: OutputType = "text";
        return { ...baseProps, type: t, value: value as React.ReactNode };
      }
    }
  }

  /** Render the read-only `<Output>` block for this field + value. */
  public CreateOutput(value: unknown, opts?: FieldOutputOpts): React.ReactNode {
    const props = this.toOutputProps(value, opts);
    return <Output {...props} />;
  }

  // ───────────────────── Input (editable control) ─────────────────────

  /**
   * Pure descriptor of the right input control for this field. Platform-neutral.
   *
   * Salesforce parallel: `lightning-input-field` driven by the field's metadata.
   */
  public toInputProps(value: unknown, opts?: FieldInputOpts): FieldInputDescriptor {
    const id = `field-${this.apiName}`;
    const base = {
      id,
      label: this.label,
      required: this.required,
      readOnly: this.readOnly,
      value,
      error: opts?.error,
    };

    switch (this.dataType) {
      case ObjectFieldDataTypes.Boolean:
        return { ...base, kind: "checkbox" };

      case ObjectFieldDataTypes.Picklist:
      case ObjectFieldDataTypes.MultiPicklist:
        return {
          ...base,
          kind: "select",
          options: this.picklist
            ? Array.from(this.picklist.options.values()).map((o) => ({
                value: o.value,
                label: o.label,
                isDefault: o.isDefault,
              }))
            : [],
        };

      case ObjectFieldDataTypes.Reference:
        return { ...base, kind: "lookup", relationship: this.relationship };

      case ObjectFieldDataTypes.Integer:
      case ObjectFieldDataTypes.Decimal:
        return { ...base, kind: "input-number" };

      case ObjectFieldDataTypes.Date:
        return { ...base, kind: "input-date" };

      case ObjectFieldDataTypes.Datetime:
        return { ...base, kind: "input-datetime" };

      default:
        return { ...base, kind: "input-text" };
    }
  }

  /** Render an editable AdriCore form control for this field, wrapped in `FormElement`. */
  public CreateInput(
    value: unknown,
    onChange: (value: unknown) => void,
    opts?: FieldInputOpts,
  ): React.ReactNode {
    const desc = this.toInputProps(value, opts);
    const commonProps = {
      id: desc.id,
      disabled: desc.readOnly,
      required: desc.required,
    };

    if (desc.kind === "checkbox") {
      return (
        <Checkbox
          {...commonProps}
          label={desc.label}
          checked={Boolean(desc.value)}
          onCheckedChange={(checked) => onChange(checked)}
        />
      );
    }

    let control: React.ReactNode;
    switch (desc.kind) {
      case "select":
        control = (
          <Select
            {...commonProps}
            value={(desc.value as string | number | undefined) ?? ""}
            onChange={(e) => onChange(e.target.value)}
          >
            <option value="" disabled>
              Select an option
            </option>
            {(desc.options ?? []).map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>
        );
        break;

      case "lookup":
        control = (
          <Lookup
            {...commonProps}
            relationship={desc.relationship}
            value={(desc.value as string | number | undefined) ?? ""}
            onChange={(e) => onChange(e.target.value)}
          />
        );
        break;

      case "input-number":
        control = (
          <Input
            {...commonProps}
            type="number"
            value={(desc.value as string | number | undefined) ?? ""}
            onChange={(e) => onChange(e.target.value)}
          />
        );
        break;

      case "input-date":
        control = (
          <Input
            {...commonProps}
            type="date"
            value={(desc.value as string | undefined) ?? ""}
            onChange={(e) => onChange(e.target.value)}
          />
        );
        break;

      case "input-datetime":
        control = (
          <Input
            {...commonProps}
            type="datetime-local"
            value={(desc.value as string | undefined) ?? ""}
            onChange={(e) => onChange(e.target.value)}
          />
        );
        break;

      case "input-text":
      default:
        control = (
          <Input
            {...commonProps}
            type="text"
            value={(desc.value as string | number | undefined) ?? ""}
            onChange={(e) => onChange(e.target.value)}
          />
        );
        break;
    }

    return (
      <FormElement id={desc.id} label={desc.label} required={desc.required} error={desc.error}>
        {control}
      </FormElement>
    );
  }

  // ───────────────────── Table column ─────────────────────

  /** Pure `ColumnDef` describing this field as a table column. */
  public toColumnDef(): ColumnDef {
    const field = this;
    return {
      field,
      key: this.apiName,
      label: this.label,
      renderCell(record, opts) {
        return field.CreateOutput(record[field.apiName], opts);
      },
    };
  }

  /** Alias of `toColumnDef`; kept for naming symmetry with `Create*` methods. */
  public CreateColumn(): ColumnDef {
    return this.toColumnDef();
  }
}
