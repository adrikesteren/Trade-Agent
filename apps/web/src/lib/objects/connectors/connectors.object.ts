import { iconRegistry } from "../icons";
import { ObjectMetadata, ObjectLabelMetadata } from "@repo/adricore/metadata";

export class ConnectorsModel extends ObjectMetadata {
  constructor() {
    super(
      "public",
      "connectors",
      "connectors",
      new ObjectLabelMetadata("Connector", "Connectors"),
      iconRegistry.registrations.get("Database")!
    );
  }
}
