import { iconRegistry } from "./icons";
import { ObjectMetadata, ObjectLabelMetadata } from "@repo/adricore/metadata";

export class CandleTimestampsModel extends ObjectMetadata {
  constructor() {
    super(
      "catalog",
      "candle_timestamps",
      "candle_timestamps",
      new ObjectLabelMetadata("Candle Timestamp", "Candle Timestamps"),
      iconRegistry.registrations.get("Database")!
    );
  }
}
