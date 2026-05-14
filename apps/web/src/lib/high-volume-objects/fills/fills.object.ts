import { iconRegistry } from "../../objects/icons";
import { HighVolumeObjectMetadata, ObjectLabelMetadata } from "@repo/adricore/metadata";

export class FillsModel extends HighVolumeObjectMetadata {
  constructor() {
    super(
      "trading",
      "fills",
      "fills",
      new ObjectLabelMetadata("Fill", "Fills"),
      iconRegistry.registrations.get("Database")!,
    );
  }
}
