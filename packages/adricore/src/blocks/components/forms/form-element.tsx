import * as React from "react";
import * as Label from "@radix-ui/react-label";
import { cx } from "../../lib/cx";

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
    <div className={cx("bk-form-element", className)}>
      <Label.Root className="bk-form-label" htmlFor={htmlFor}>
        {label}
        {required ? <span className="bk-form-label_required" aria-hidden> *</span> : null}
      </Label.Root>
      {children}
      {help && !error ? <p className="bk-form-help">{help}</p> : null}
      {error ? (
        <p className="bk-form-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
