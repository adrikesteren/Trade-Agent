import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cx } from "../../lib/cx";
import { Spinner } from "../feedback/spinner";

export type ButtonVariant = "brand" | "neutral" | "destructive" | "ghost" | "outline-brand";
export type ButtonSize = "sm" | "md" | "lg";

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  asChild?: boolean;
};

const variantClass: Record<ButtonVariant, string> = {
  brand: "bk-button_brand",
  neutral: "bk-button_neutral",
  destructive: "bk-button_destructive",
  ghost: "bk-button_ghost",
  "outline-brand": "bk-button_outline-brand",
};

const sizeClass: Record<ButtonSize, string> = {
  sm: "bk-button_sm",
  md: "",
  lg: "bk-button_lg",
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "brand", size = "md", loading, disabled, asChild, children, ...props },
  ref,
) {
  const showSpinner = Boolean(loading) && !asChild;
  const Comp = asChild ? Slot : "button";
  const isDisabled = disabled || (loading && !asChild);

  return (
    <Comp
      ref={ref as never}
      className={cx("bk-button", variantClass[variant], sizeClass[size], className)}
      disabled={asChild ? undefined : isDisabled}
      aria-disabled={asChild && isDisabled ? true : undefined}
      {...props}
    >
      {showSpinner ? (
        <>
          <Spinner aria-hidden />
          <span className="bk-sr-only">Loading</span>
          {children}
        </>
      ) : (
        children
      )}
    </Comp>
  );
});
