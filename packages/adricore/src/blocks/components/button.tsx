import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cx } from "../lib/cx";
import { Spinner } from "./spinner";

export type ButtonVariant = "brand" | "neutral" | "destructive" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  asChild?: boolean;
};

const variantClass: Record<ButtonVariant, string> = {
  brand: "adri-button_brand",
  neutral: "adri-button_neutral",
  destructive: "adri-button_destructive",
  ghost: "adri-button_ghost",
};

const sizeClass: Record<ButtonSize, string> = {
  sm: "adri-button_sm",
  md: "",
  lg: "adri-button_lg",
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
      className={cx("adri-button", variantClass[variant], sizeClass[size], className)}
      disabled={asChild ? undefined : isDisabled}
      aria-disabled={asChild && isDisabled ? true : undefined}
      {...props}
    >
      {showSpinner ? (
        <>
          <Spinner aria-hidden />
          <span className="adri-sr-only">Loading</span>
          {children}
        </>
      ) : (
        children
      )}
    </Comp>
  );
});
