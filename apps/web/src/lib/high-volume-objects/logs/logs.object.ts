import { iconRegistry } from "../../objects/icons";
import { HighVolumeObjectMetadata, ObjectLabelMetadata } from "@adrikesteren/adricore/metadata";

export class LogsModel extends HighVolumeObjectMetadata {
  constructor() {
    super(
      "public",
      "logs",
      "logs",
      new ObjectLabelMetadata("Log", "Logs"),
      iconRegistry.registrations.get("Database")!,
    );
  }
}
