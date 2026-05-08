export function SignOutButton() {
  return (
    <form action="/api/auth/signout" method="post">
      <button
        type="submit"
        className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-800 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
      >
        Sign out
      </button>
    </form>
  );
}
