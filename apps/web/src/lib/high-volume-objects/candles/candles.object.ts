import { iconRegistry } from "../../objects/icons";
import { HighVolumeObjectMetadata, ObjectLabelMetadata } from "@adrikesteren/adricore/metadata";

export class CandlesModel extends HighVolumeObjectMetadata {
  constructor() {
    super(
      "catalog",
      "candles",
      "candles",
      new ObjectLabelMetadata("Candle", "Candles"),
      iconRegistry.registrations.get("Database")!,
    );
  }
}
