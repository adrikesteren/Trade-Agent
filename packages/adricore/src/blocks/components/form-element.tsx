import * as React from "react";
import * as Label from "@radix-ui/react-label";
import { cx } from "../lib/cx";

export type FormElementProps = {
  id: string;
  label: React.ReactNode;
  htmlFor?: string;
  help?: React.ReactNode;
  error?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  required?: boolean;
};

export function FormElement({ id, label, htmlFor = id, help, error, children, className, required }: FormElementProps) {
  return (
    <div className={cx("adri-form-element", className)}>
      <Label.Root className="adri-form-label" htmlFor={htmlFor}>
        {label}
        {required ? <span className="adri-text-muted"> *</span> : null}
      </Label.Root>
      {children}
      {help && !error ? <p className="adri-form-help">{help}</p> : null}
      {error ? <p className="adri-form-error">{error}</p> : null}
    </div>
  );
}
