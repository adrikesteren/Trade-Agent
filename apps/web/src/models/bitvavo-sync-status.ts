import { iconRegistry } from "./icons";
import { ObjectMetadata, ObjectLabelMetadata } from "@repo/adricore/metadata";

export class BitvavoSyncStatusModel extends ObjectMetadata {
  constructor() {
    super(
      "public",
      "bitvavo_sync_status",
      "bitvavo_sync_status",
      new ObjectLabelMetadata("Bitvavo Sync Status", "Bitvavo Sync Statuses"),
      iconRegistry.registrations.get("Database")!
    );
  }
}
