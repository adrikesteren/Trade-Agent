import { iconRegistry } from "./icons";
import { ObjectMetadata, ObjectLabelMetadata } from "@repo/adricore/metadata";

export class LogsModel extends ObjectMetadata {
  constructor() {
    super(
      "public",
      "logs",
      "logs",
      new ObjectLabelMetadata("Log", "Logs"),
      iconRegistry.registrations.get("Database")!
    );
  }
}
