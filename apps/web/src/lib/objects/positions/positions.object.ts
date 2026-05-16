import { iconRegistry } from "../icons";
import { ObjectMetadata, ObjectLabelMetadata } from "@adrikesteren/adricore/metadata";

export class PositionsModel extends ObjectMetadata {
  constructor() {
    super(
      "trading",
      "positions",
      "positions",
      new ObjectLabelMetadata("Position", "Positions"),
      iconRegistry.registrations.get("Database")!,
    );
    this.nameField = {
      mode: "autoNumber",
      displayFormat: "POS-{0000}",
      startNumber: 1,
    };
  }
}
