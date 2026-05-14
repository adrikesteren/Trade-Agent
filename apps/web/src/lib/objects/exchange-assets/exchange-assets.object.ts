import { iconRegistry } from "../icons";
import { ObjectMetadata, ObjectLabelMetadata } from "@repo/adricore/metadata";

export class ExchangeAssetsModel extends ObjectMetadata {
  constructor() {
    super(
      "public",
      "exchange_assets",
      "exchange_assets",
      new ObjectLabelMetadata("Exchange Asset", "Exchange Assets"),
      iconRegistry.registrations.get("Database")!
    );
  }
}
