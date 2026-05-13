import * as React from "react";
import { cx } from "../lib/cx";

export function AppShell({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("adri-app-shell", className)} {...props} />;
}

export type AppHeaderProps = React.HTMLAttributes<HTMLElement> & {
  brand: React.ReactNode;
  nav?: React.ReactNode;
  actions?: React.ReactNode;
};

export function AppHeader({ brand, nav, actions, className, ...props }: AppHeaderProps) {
  return (
    <header className={cx("adri-app-header", className)} {...props}>
      <div className="adri-app-header_nav">
        {brand}
        {nav}
      </div>
      {actions ? <div className="adri-app-header_actions">{actions}</div> : null}
    </header>
  );
}

export function AppMain({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return <main className={cx("adri-app-main", className)} {...props} />;
}
