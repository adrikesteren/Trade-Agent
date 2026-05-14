import { describe, expect, it } from "vitest";

import { executorAllowedSides } from "./executors-lookup.service";

describe("executorAllowedSides", () => {
  it("defaults to ['long'] when allowed_sides is undefined", () => {
    expect(executorAllowedSides({ allowed_sides: undefined })).toEqual(["long"]);
  });

  it("defaults to ['long'] when allowed_sides is null", () => {
    expect(executorAllowedSides({ allowed_sides: null })).toEqual(["long"]);
  });

  it("defaults to ['long'] when allowed_sides is an empty array", () => {
    expect(executorAllowedSides({ allowed_sides: [] })).toEqual(["long"]);
  });

  it("returns the array as-is when only 'long' is configured", () => {
    expect(executorAllowedSides({ allowed_sides: ["long"] })).toEqual(["long"]);
  });

  it("returns ['long','short'] when both sides are allowed", () => {
    expect(executorAllowedSides({ allowed_sides: ["long", "short"] })).toEqual(["long", "short"]);
  });

  it("returns ['short'] when only short is allowed (margin-only exchange)", () => {
    expect(executorAllowedSides({ allowed_sides: ["short"] })).toEqual(["short"]);
  });
});
