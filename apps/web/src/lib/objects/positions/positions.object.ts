import { iconRegistry } from "../icons";
import { ObjectMetadata, ObjectLabelMetadata } from "@repo/adricore/metadata";

export class PositionsModel extends ObjectMetadata {
  constructor() {
    super(
      "trading",
      "positions",
      "positions",
      new ObjectLabelMetadata("Position", "Positions"),
      iconRegistry.registrations.get("Database")!
    );
  }
}
