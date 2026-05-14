import { iconRegistry } from "../icons";
import { ObjectMetadata, ObjectLabelMetadata } from "@repo/adricore/metadata";

export class SignalsModel extends ObjectMetadata {
  constructor() {
    super(
      "trading",
      "signals",
      "signals",
      new ObjectLabelMetadata("Signal", "Signals"),
      iconRegistry.registrations.get("Database")!
    );
  }
}
