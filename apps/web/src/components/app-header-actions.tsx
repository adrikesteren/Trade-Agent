import { menuTriggerPlainClass } from "@repo/adricore/blocks";
import Link from "next/link";

import { SignOutButton } from "@/components/sign-out-button";

export function AppHeaderActions() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link href="/logs" className={menuTriggerPlainClass}>
        Logs
      </Link>
      <Link href="/docs" className={menuTriggerPlainClass}>
        Docs
      </Link>
      <SignOutButton />
    </div>
  );
}
