import { DEFAULT_APP_ID } from "@repo/adricore/metadata";
import { describe, expect, it } from "vitest";

import { resolveActiveAppId } from "./app-shell";

describe("resolveActiveAppId", () => {
  it("uses default when cookie is undefined", () => {
    expect(resolveActiveAppId(undefined)).toBe(DEFAULT_APP_ID);
  });

  it("uses default when cookie is unknown", () => {
    expect(resolveActiveAppId("unknown-app")).toBe(DEFAULT_APP_ID);
  });

  it("accepts a valid registry key", () => {
    expect(resolveActiveAppId("catalog-focus")).toBe("catalog-focus");
  });
});
