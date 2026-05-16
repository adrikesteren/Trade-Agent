import { iconRegistry } from "../../objects/icons";
import { HighVolumeObjectMetadata, ObjectLabelMetadata } from "@adrikesteren/adricore/metadata";

export class SyncRunsModel extends HighVolumeObjectMetadata {
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
