import { iconRegistry } from "./icons";
import { ObjectMetadata, ObjectLabelMetadata } from "@repo/adricore/metadata";

export class RiskStateModel extends ObjectMetadata {
  constructor() {
    super(
      "trading",
      "risk_state",
      "risk_state",
      new ObjectLabelMetadata("Risk State", "Risk States"),
      iconRegistry.registrations.get("Database")!
    );
  }
}
