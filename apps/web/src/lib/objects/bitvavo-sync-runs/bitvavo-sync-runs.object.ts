import { iconRegistry } from "../icons";
import { ObjectMetadata, ObjectLabelMetadata } from "@repo/adricore/metadata";

export class BitvavoSyncRunsModel extends ObjectMetadata {
  constructor() {
    super(
      "public",
      "bitvavo_sync_runs",
      "bitvavo_sync_runs",
      new ObjectLabelMetadata("Bitvavo Sync Run", "Bitvavo Sync Runs"),
      iconRegistry.registrations.get("Database")!
    );
  }
}
