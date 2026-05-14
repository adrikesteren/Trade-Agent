import { iconRegistry } from "../../objects/icons";
import { HighVolumeObjectMetadata, ObjectLabelMetadata } from "@repo/adricore/metadata";

export class SignalRunsModel extends HighVolumeObjectMetadata {
  constructor() {
    super(
      "automation",
      "signal_runs",
      "signal_runs",
      new ObjectLabelMetadata("Signal Run", "Signal Runs"),
      iconRegistry.registrations.get("Database")!,
    );
  }
}
