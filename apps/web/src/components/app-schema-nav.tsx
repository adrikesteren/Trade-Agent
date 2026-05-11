"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  menuTriggerPlainClass,
} from "@repo/blocks";
import Link from "next/link";

export function AppSchemaNav() {
  return (
    <nav className="flex flex-wrap items-center gap-3 text-xs">
      <Link href="/overview" className={menuTriggerPlainClass}>
        Overview
      </Link>
      <Link href="/me/preferences" className={menuTriggerPlainClass}>
        Preferences
      </Link>

      <DropdownMenu>
        <DropdownMenuTrigger className={menuTriggerPlainClass}>Catalog</DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem asChild>
            <Link href="/assets">Assets</Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/markets">Markets</Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/exchanges">Exchanges</Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger className={menuTriggerPlainClass}>Trading</DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem asChild>
            <Link href="/signals">Signals</Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/signal-agents">Signal Agents</Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/trade-decisions">Trading Decisions</Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/orders">Orders</Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/fills">Fills</Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/positions">Positions</Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/risk-state">Risk State</Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/executors">Executors</Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Link href="/system-settings" className={menuTriggerPlainClass}>
        System settings
      </Link>

      <DropdownMenu>
        <DropdownMenuTrigger className={menuTriggerPlainClass}>Automation</DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem asChild>
            <Link href="/sync-runs">Sync Runs</Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/signal-jobs">Signal Jobs</Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/signal-runs">Signal Runs</Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </nav>
  );
}
