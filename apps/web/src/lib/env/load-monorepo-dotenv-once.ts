import dotenv from "dotenv";
import fs from "fs";
import path from "path";

let loaded = false;

/**
 * Loads `.env` / `.env.local` from `process.cwd()` up to the filesystem root, **root → leaf** order
 * so repo-root values apply first and `apps/web/.env.local` can override.
 *
 * **Do not** resolve the repo via `import.meta.url` here: Turbopack bundles this module under `.next/`,
 * so `fileURLToPath(import.meta.url)` no longer sits under `src/lib/…` and the old `../..` math pointed
 * at nonsense — `NEXT_PUBLIC_*` never loaded.
 */
export function loadMonorepoDotenvOnce(): void {
  if (loaded) return;
  loaded = true;

  const dirs: string[] = [];
  let d = process.cwd();
  for (let i = 0; i < 12; i++) {
    dirs.push(d);
    const parent = path.dirname(d);
    if (parent === d) break;
    d = parent;
  }

  for (const dir of [...dirs].reverse()) {
    for (const name of [".env", ".env.local"] as const) {
      const f = path.join(dir, name);
      try {
        if (fs.existsSync(f)) {
          dotenv.config({ path: f, override: true });
        }
      } catch {
        /* ignore */
      }
    }
  }

  const cwd0 = process.cwd();
  if (path.basename(cwd0) !== "web") {
    for (const name of [".env", ".env.local"] as const) {
      const f = path.join(cwd0, "apps", "web", name);
      try {
        if (fs.existsSync(f)) {
          dotenv.config({ path: f, override: true });
        }
      } catch {
        /* ignore */
      }
    }
  }
}
