import { iconRegistry } from "./icons";
import { ObjectMetadata, ObjectLabelMetadata } from "@repo/adricore/metadata";

export class SystemSettingsModel extends ObjectMetadata {
  constructor() {
    super(
      "public",
      "system_settings",
      "system_settings",
      new ObjectLabelMetadata("System Setting", "System Settings"),
      iconRegistry.registrations.get("Database")!
    );
  }
}
