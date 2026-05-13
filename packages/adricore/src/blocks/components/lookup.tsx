"use client";

import * as React from "react";
import { cx } from "../lib/cx";
import type { ObjectRelationshipMetadata } from "@repo/adricore/metadata";
import { Search } from "lucide-react";

export type LookupProps = React.InputHTMLAttributes<HTMLInputElement> & {
  relationship?: ObjectRelationshipMetadata;
  onSearch?: (query: string) => void;
  onSelectResult?: (id: string, label: string) => void;
};

export const Lookup = React.forwardRef<HTMLInputElement, LookupProps>(function Lookup(
  { className, relationship, onSearch, onSelectResult, ...props },
  ref,
) {
  // A basic structure for SLDS-style lookup
  // Actual combobox / popover functionality can be added later
  return (
    <div className={cx("adri-lookup-container relative flex items-center", className)}>
      <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-500 pointer-events-none" />
      <input 
        ref={ref} 
        className={cx("adri-input pl-9", className)} 
        placeholder={relationship ? `Search ${relationship.referenceObject.label.plural}...` : "Search..."}
        onChange={(e) => onSearch && onSearch(e.target.value)}
        {...props} 
      />
    </div>
  );
});
