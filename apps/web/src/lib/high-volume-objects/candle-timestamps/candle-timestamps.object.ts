import { iconRegistry } from "../../objects/icons";
import { HighVolumeObjectMetadata, ObjectLabelMetadata } from "@repo/adricore/metadata";

export class CandleTimestampsModel extends HighVolumeObjectMetadata {
  constructor() {
    super(
      "catalog",
      "candle_timestamps",
      "candle_timestamps",
      new ObjectLabelMetadata("Candle Timestamp", "Candle Timestamps"),
      iconRegistry.registrations.get("Database")!,
    );
  }
}
