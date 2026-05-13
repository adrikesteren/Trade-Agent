"use client";

import * as React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cx } from "../lib/cx";

export type SwitchProps = React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root> & {
  label?: React.ReactNode;
};

export const Switch = React.forwardRef<React.ElementRef<typeof SwitchPrimitive.Root>, SwitchProps>(
  function Switch({ className, label, id, ...props }, ref) {
    const autoId = React.useId();
    const inputId = id ?? autoId;

    const control = (
      <SwitchPrimitive.Root ref={ref} id={inputId} className={cx("adri-switch-root", className)} {...props}>
        <SwitchPrimitive.Thumb className="adri-switch-thumb" />
      </SwitchPrimitive.Root>
    );

    if (label) {
      return (
        <div className="adri-switch-row">
          {control}
          <label htmlFor={inputId} className="adri-form-label" style={{ margin: 0, fontWeight: 500 }}>
            {label}
          </label>
        </div>
      );
    }

    return control;
  },
);
