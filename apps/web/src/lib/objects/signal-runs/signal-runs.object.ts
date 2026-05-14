import { iconRegistry } from "../icons";
import { ObjectMetadata, ObjectLabelMetadata } from "@repo/adricore/metadata";

export class SignalRunsModel extends ObjectMetadata {
  constructor() {
    super(
      "automation",
      "signal_runs",
      "signal_runs",
      new ObjectLabelMetadata("Signal Run", "Signal Runs"),
      iconRegistry.registrations.get("Database")!
    );
  }
}
