import { Button } from "@repo/adricore/blocks";

export function SignOutButton() {
  return (
    <form action="/api/auth/signout" method="post">
      <Button type="submit" variant="neutral" size="sm">
        Sign out
      </Button>
    </form>
  );
}
