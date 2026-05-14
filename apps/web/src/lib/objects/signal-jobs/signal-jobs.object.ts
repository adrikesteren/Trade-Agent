import { iconRegistry } from "../icons";
import { ObjectMetadata, ObjectLabelMetadata } from "@repo/adricore/metadata";

export class SignalJobsModel extends ObjectMetadata {
  constructor() {
    super(
      "automation",
      "signal_jobs",
      "signal_jobs",
      new ObjectLabelMetadata("Signal Job", "Signal Jobs"),
      iconRegistry.registrations.get("Database")!
    );
  }
}
