import * as React from "react";
import { cx } from "../lib/cx";

export type LinkTextProps = React.AnchorHTMLAttributes<HTMLAnchorElement>;

/** Styled anchor for use inside app router with next/link `legacyBehavior` or plain `<a>`. */
export const LinkText = React.forwardRef<HTMLAnchorElement, LinkTextProps>(function LinkText(
  { className, ...props },
  ref,
) {
  return <a ref={ref} className={cx("bk-link", className)} {...props} />;
});
