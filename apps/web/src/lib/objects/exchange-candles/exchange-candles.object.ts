import { iconRegistry } from "../icons";
import { ObjectMetadata, ObjectLabelMetadata } from "@repo/adricore/metadata";

export class ExchangeCandlesModel extends ObjectMetadata {
  constructor() {
    super(
      "public",
      "exchange_candles",
      "exchange_candles",
      new ObjectLabelMetadata("Exchange Candle", "Exchange Candles"),
      iconRegistry.registrations.get("Database")!
    );
  }
}
