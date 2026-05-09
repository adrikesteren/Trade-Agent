"use client";

import Link from "next/link";
import { useState } from "react";

type MenuKey = "catalog" | "trading" | "automation";

type SchemaMenuProps = {
  menuKey: MenuKey;
  label: string;
  openKey: MenuKey | null;
  setOpenKey: (key: MenuKey | null) => void;
  children: React.ReactNode;
};

function SchemaMenu({ menuKey, label, openKey, setOpenKey, children }: SchemaMenuProps) {
  const isOpen = openKey === menuKey;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpenKey(isOpen ? null : menuKey)}
        className="text-zinc-600 underline-offset-4 hover:text-zinc-900 hover:underline dark:text-zinc-400 dark:hover:text-zinc-100"
      >
        {label}
      </button>
      {isOpen ? (
        <div className="absolute left-0 top-5 z-10 min-w-52 rounded-md border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex flex-col gap-1">{children}</div>
        </div>
      ) : null}
    </div>
  );
}

const itemClass = "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100";

export function DashboardSchemaNav() {
  const [openKey, setOpenKey] = useState<MenuKey | null>(null);

  return (
    <nav className="flex items-center gap-3 text-xs">
      <Link
        href="/dashboard"
        className="text-zinc-600 underline-offset-4 hover:text-zinc-900 hover:underline dark:text-zinc-400 dark:hover:text-zinc-100"
      >
        Overview
      </Link>

      <SchemaMenu menuKey="catalog" label="Catalog" openKey={openKey} setOpenKey={setOpenKey}>
        <Link href="/dashboard/assets" className={itemClass} onClick={() => setOpenKey(null)}>
          Assets
        </Link>
        <Link href="/dashboard/markets" className={itemClass} onClick={() => setOpenKey(null)}>
          Markets
        </Link>
        <Link href="/dashboard/exchanges" className={itemClass} onClick={() => setOpenKey(null)}>
          Exchanges
        </Link>
      </SchemaMenu>

      <SchemaMenu menuKey="trading" label="Trading" openKey={openKey} setOpenKey={setOpenKey}>
        <Link href="/dashboard/signals" className={itemClass} onClick={() => setOpenKey(null)}>
          Signals
        </Link>
        <Link href="/dashboard/signal-agents" className={itemClass} onClick={() => setOpenKey(null)}>
          Signal Agents
        </Link>
        <Link href="/dashboard/trade-decisions" className={itemClass} onClick={() => setOpenKey(null)}>
          Trading Decisions
        </Link>
        <Link href="/dashboard/orders" className={itemClass} onClick={() => setOpenKey(null)}>
          Orders
        </Link>
        <Link href="/dashboard/fills" className={itemClass} onClick={() => setOpenKey(null)}>
          Fills
        </Link>
        <Link href="/dashboard/positions" className={itemClass} onClick={() => setOpenKey(null)}>
          Positions
        </Link>
        <Link href="/dashboard/risk-state" className={itemClass} onClick={() => setOpenKey(null)}>
          Risk State
        </Link>
      </SchemaMenu>

      <SchemaMenu menuKey="automation" label="Automation" openKey={openKey} setOpenKey={setOpenKey}>
        <Link href="/dashboard/sync-runs" className={itemClass} onClick={() => setOpenKey(null)}>
          Sync Runs
        </Link>
        <Link href="/dashboard/signal-jobs" className={itemClass} onClick={() => setOpenKey(null)}>
          Signal Jobs
        </Link>
        <Link href="/dashboard/signal-runs" className={itemClass} onClick={() => setOpenKey(null)}>
          Signal Runs
        </Link>
      </SchemaMenu>
    </nav>
  );
}
