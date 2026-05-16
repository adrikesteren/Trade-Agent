import { iconRegistry } from "../../objects/icons";
import { HighVolumeObjectMetadata, ObjectLabelMetadata } from "@adrikesteren/adricore/metadata";

export class SignalJobsModel extends HighVolumeObjectMetadata {
  constructor() {
    super(
      "automation",
      "signal_jobs",
      "signal_jobs",
      new ObjectLabelMetadata("Signal Job", "Signal Jobs"),
      iconRegistry.registrations.get("Database")!,
    );
  }
}
