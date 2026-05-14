import * as React from "react";
import { OptionsIsRequiredException, TooManyPickOptionDefaultsException } from "./exceptions";
import { Badge, type BadgeProps, type BadgeTone } from "../blocks/components/feedback/badge";

export class PicklistOptionMetadata {
  public readonly value: string;
  public readonly label: string;
  public readonly isDefault: boolean;
  /** Optional badge tone hint for `CreateBadge`. Defaults to `neutral` if omitted. */
  public readonly tone?: BadgeTone;

  constructor(value: string, label: string, isDefault: boolean = false, tone?: BadgeTone) {
    this.value = value;
    this.label = label;
    this.isDefault = isDefault;
    this.tone = tone;
  }
}

/** Pure shape for `<Badge>` rendering of a picklist value. */
export type PicklistBadgeDescriptor = {
  tone: BadgeTone;
  label: string;
};

export class PicklistMetadata {
  public readonly options: Map<string, PicklistOptionMetadata> = new Map<
    string,
    PicklistOptionMetadata
  >();

  constructor(options: PicklistOptionMetadata[]) {
    if (!options) {
      throw new OptionsIsRequiredException();
    }
    let defaultCount = 0;
    for (const option of options) {
      if (option.isDefault) {
        defaultCount++;
        if (defaultCount > 1) {
          throw new TooManyPickOptionDefaultsException();
        }
      }
      this.options.set(option.value, option);
    }
  }

  /** Look up an option by raw value. */
  public getOption(value: unknown): PicklistOptionMetadata | undefined {
    if (value === null || value === undefined) return undefined;
    return this.options.get(String(value));
  }

  /** Resolved label for a value; falls back to the raw value when the option is unknown. */
  public getOptionLabel(value: unknown): string {
    const opt = this.getOption(value);
    if (opt) return opt.label;
    return value === null || value === undefined ? "" : String(value);
  }

  /** Pure list shape for `<Select>` / `<option>` iteration. */
  public toSelectOptions(): { value: string; label: string; isDefault: boolean }[] {
    return Array.from(this.options.values()).map((o) => ({
      value: o.value,
      label: o.label,
      isDefault: o.isDefault,
    }));
  }

  /** Pure descriptor for a `<Badge>` rendering of a picklist value. */
  public toBadgeProps(value: unknown): PicklistBadgeDescriptor {
    const opt = this.getOption(value);
    return {
      tone: opt?.tone ?? "neutral",
      label: this.getOptionLabel(value),
    };
  }

  /** Render a `<Badge>` for a picklist value. */
  public CreateBadge(value: unknown, opts?: { className?: string }): React.ReactNode {
    const desc = this.toBadgeProps(value);
    const badgeProps: BadgeProps = { tone: desc.tone, className: opts?.className };
    return <Badge {...badgeProps}>{desc.label}</Badge>;
  }
}
