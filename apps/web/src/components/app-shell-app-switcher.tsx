"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  menuTriggerPlainClass,
} from "@adrikesteren/adricore/blocks";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import type { DashboardAppId } from "@/config/app-shell";
import { selectDashboardApp } from "@/lib/shell/dashboard-app-actions";

export type AppShellAppSwitcherProps = {
  options: { id: DashboardAppId; label: string }[];
  currentId: DashboardAppId;
};

export function AppShellAppSwitcher({ options, currentId }: AppShellAppSwitcherProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (options.length <= 1) {
    return null;
  }

  const currentLabel = options.find((o) => o.id === currentId)?.label ?? currentId;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={menuTriggerPlainClass} disabled={pending}>
        {currentLabel}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {options.map((opt) => (
          <DropdownMenuItem
            key={opt.id}
            disabled={opt.id === currentId || pending}
            onSelect={() => {
              startTransition(async () => {
                await selectDashboardApp(opt.id);
                router.refresh();
              });
            }}
          >
            {opt.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
