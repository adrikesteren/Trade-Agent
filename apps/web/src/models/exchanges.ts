import { iconRegistry } from "./icons";
import { ObjectMetadata, ObjectLabelMetadata } from "@repo/adricore/metadata";

export class ExchangesModel extends ObjectMetadata {
  constructor() {
    super(
      "public",
      "exchanges",
      "exchanges",
      new ObjectLabelMetadata("Exchange", "Exchanges"),
      iconRegistry.registrations.get("Database")!
    );
  }
}
