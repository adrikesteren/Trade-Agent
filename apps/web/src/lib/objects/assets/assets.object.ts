import { iconRegistry } from "../icons";
import { ObjectMetadata, ObjectLabelMetadata } from "@repo/adricore/metadata";

export class AssetsModel extends ObjectMetadata {
  constructor() {
    super(
      "catalog",
      "assets",
      "assets",
      new ObjectLabelMetadata("Asset", "Assets"),
      iconRegistry.registrations.get("Database")!,
    );
    this.nameField = { mode: "manual" };
  }
}
