import { iconRegistry } from "../icons";
import { ObjectMetadata, ObjectLabelMetadata } from "@repo/adricore/metadata";

export class SyncRunsModel extends ObjectMetadata {
  constructor() {
    super(
      "automation",
      "sync_runs",
      "sync_runs",
      new ObjectLabelMetadata("Sync Run", "Sync Runs"),
      iconRegistry.registrations.get("Database")!,
    );
  }
}
