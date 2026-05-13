import { iconRegistry } from "./icons";
import { ObjectMetadata, ObjectLabelMetadata } from "@repo/adricore/metadata";

export class CandlesModel extends ObjectMetadata {
  constructor() {
    super(
      "public",
      "candles",
      "candles",
      new ObjectLabelMetadata("Candle", "Candles"),
      iconRegistry.registrations.get("Database")!
    );
  }
}
