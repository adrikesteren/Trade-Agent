import { menuTriggerPlainClass } from "@repo/blocks";
import Link from "next/link";

import { SignOutButton } from "@/components/sign-out-button";

export function AppHeaderActions() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link href="/docs" className={menuTriggerPlainClass}>
        Docs
      </Link>
      <SignOutButton />
    </div>
  );
}
