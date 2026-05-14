"use client";

import * as React from "react";
import { Search } from "lucide-react";
import { cx } from "../../lib/cx";
import type { ObjectRelationshipMetadata } from "@repo/adricore/metadata";

export type LookupProps = React.InputHTMLAttributes<HTMLInputElement> & {
  relationship?: ObjectRelationshipMetadata;
  onSearch?: (query: string) => void;
  onSelectResult?: (id: string, label: string) => void;
};

/**
 * Lightning-style lookup input. Combobox / result-picker behaviour is intentionally
 * deferred — callers wire the actual search/result handling.
 */
export const Lookup = React.forwardRef<HTMLInputElement, LookupProps>(function Lookup(
  { className, relationship, onSearch, onChange, placeholder, ...props },
  ref,
) {
  const fallbackPlaceholder = relationship
    ? `Search ${relationship.referenceObject.label.plural}…`
    : "Search…";

  return (
    <div className="bk-lookup">
      <Search className="bk-lookup_glyph" size={14} strokeWidth={2} aria-hidden />
      <input
        ref={ref}
        type="text"
        className={cx("bk-input", "bk-lookup_input", className)}
        placeholder={placeholder ?? fallbackPlaceholder}
        onChange={(e) => {
          onSearch?.(e.target.value);
          onChange?.(e);
        }}
        {...props}
      />
    </div>
  );
});
