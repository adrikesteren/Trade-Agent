"use client";

import * as React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cx } from "../../lib/cx";

export type SwitchProps = React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root> & {
  label?: React.ReactNode;
};

export const Switch = React.forwardRef<React.ElementRef<typeof SwitchPrimitive.Root>, SwitchProps>(
  function Switch({ className, label, id, ...props }, ref) {
    const autoId = React.useId();
    const inputId = id ?? autoId;

    const control = (
      <SwitchPrimitive.Root ref={ref} id={inputId} className={cx("bk-switch-root", className)} {...props}>
        <SwitchPrimitive.Thumb className="bk-switch-thumb" />
      </SwitchPrimitive.Root>
    );

    if (label) {
      return (
        <div className="bk-switch-row">
          {control}
          <label htmlFor={inputId} className="bk-form-label bk-form-label_inline">
            {label}
          </label>
        </div>
      );
    }

    return control;
  },
);
