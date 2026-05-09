"use client";

import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";
import { cx } from "../lib/cx";

export type CheckboxProps = React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root> & {
  label?: React.ReactNode;
};

export const Checkbox = React.forwardRef<React.ElementRef<typeof CheckboxPrimitive.Root>, CheckboxProps>(
  function Checkbox({ className, label, id, ...props }, ref) {
    const autoId = React.useId();
    const inputId = id ?? autoId;

    const control = (
      <CheckboxPrimitive.Root ref={ref} id={inputId} className={cx("bk-checkbox-root", className)} {...props}>
        <CheckboxPrimitive.Indicator className="bk-checkbox-indicator">
          <Check size={12} strokeWidth={3} aria-hidden />
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
    );

    if (label) {
      return (
        <div className="bk-checkbox-row">
          {control}
          <label htmlFor={inputId} className="bk-form-label" style={{ margin: 0, fontWeight: 500 }}>
            {label}
          </label>
        </div>
      );
    }

    return control;
  },
);
