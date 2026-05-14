import * as React from "react";
import type { FieldOutputOpts, FieldInputOpts, ObjectFieldMetadata } from "@repo/adricore/metadata";

/**
 * Back-compat facade. Prefer the instance methods on `ObjectFieldMetadata`:
 * - `field.CreateOutput(value, opts?)`
 * - `field.CreateInput(value, onChange, opts?)`
 *
 * This class is kept so existing call sites importing `FieldRenderer` keep
 * working. New code should call the metadata methods directly.
 */
export class FieldRenderer {
  static createOutput(
    field: ObjectFieldMetadata,
    value: unknown,
    opts?: FieldOutputOpts,
  ): React.ReactNode {
    return field.CreateOutput(value, opts);
  }

  static createInput(
    field: ObjectFieldMetadata,
    value: unknown,
    onChange: (value: unknown) => void,
    error?: string,
  ): React.ReactNode {
    const opts: FieldInputOpts | undefined = error ? { error } : undefined;
    return field.CreateInput(value, onChange, opts);
  }
}
