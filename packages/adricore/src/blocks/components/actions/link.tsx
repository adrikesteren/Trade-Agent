import * as React from "react";
import { cx } from "../../lib/cx";

export type LinkTextProps = React.AnchorHTMLAttributes<HTMLAnchorElement>;

/**
 * Styled anchor for cases where Next `<Link>` is not applicable.
 * For app routing, prefer Next `<Link className="bk-link">`.
 */
export const LinkText = React.forwardRef<HTMLAnchorElement, LinkTextProps>(function LinkText(
  { className, ...props },
  ref,
) {
  return <a ref={ref} className={cx("bk-link", className)} {...props} />;
});
