import { describe, expect, it } from "vitest";

import { mapBitvavoOrderStatusToDb } from "./bitvavo-order-status";

describe("mapBitvavoOrderStatusToDb", () => {
  it("maps terminal and open states", () => {
    expect(mapBitvavoOrderStatusToDb("filled")).toBe("filled");
    expect(mapBitvavoOrderStatusToDb("new")).toBe("open");
    expect(mapBitvavoOrderStatusToDb("partiallyFilled")).toBe("open");
    expect(mapBitvavoOrderStatusToDb("canceled")).toBe("cancelled");
    expect(mapBitvavoOrderStatusToDb("cancelled")).toBe("cancelled");
    expect(mapBitvavoOrderStatusToDb("expired")).toBe("cancelled");
  });
});
