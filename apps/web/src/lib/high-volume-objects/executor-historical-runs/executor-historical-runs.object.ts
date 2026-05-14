import { iconRegistry } from "../../objects/icons";
import { HighVolumeObjectMetadata, ObjectLabelMetadata } from "@repo/adricore/metadata";

export class ExecutorHistoricalRunsModel extends HighVolumeObjectMetadata {
  constructor() {
    super(
      "trading",
      "executor_historical_runs",
      "executor_historical_runs",
      new ObjectLabelMetadata("Executor Historical Run", "Executor Historical Runs"),
      iconRegistry.registrations.get("Database")!,
    );
  }
}
