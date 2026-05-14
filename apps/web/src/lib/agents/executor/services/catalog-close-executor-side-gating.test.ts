import { describe, expect, it } from "vitest";

import { parseProposedPositionSide } from "./catalog-close-executor-run.service";

describe("parseProposedPositionSide", () => {
  it("defaults to 'long' for null payloads (legacy / pre-P2 decisions)", () => {
    expect(parseProposedPositionSide(null)).toBe("long");
  });

  it("defaults to 'long' when the payload has no positionSide markers at all", () => {
    expect(parseProposedPositionSide({ resolvedIntent: "ENTER" })).toBe("long");
  });

  it("reads positionSide from the inner proposedOrder first (most specific)", () => {
    expect(
      parseProposedPositionSide({
        proposedOrder: { positionSide: "short", side: "buy" },
        positionSide: "long",
      }),
    ).toBe("short");
  });

  it("falls back to top-level positionSide when proposedOrder is null", () => {
    expect(
      parseProposedPositionSide({
        proposedOrder: null,
        positionSide: "short",
      }),
    ).toBe("short");
  });

  it("treats unknown side strings as 'long' (defensive)", () => {
    expect(
      parseProposedPositionSide({
        proposedOrder: { positionSide: "neutral" },
      }),
    ).toBe("long");
  });

  it("ignores positionSide on proposedOrder when it is not an object", () => {
    expect(
      parseProposedPositionSide({
        proposedOrder: "buy",
        positionSide: "short",
      }),
    ).toBe("short");
  });
});
