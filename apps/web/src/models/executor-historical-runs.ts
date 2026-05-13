import { ObjectMetadata, ObjectLabelMetadata } from "@repo/adricore/metadata";

export class ExecutorHistoricalRunsModel extends ObjectMetadata {
  constructor() {
    super(
      "trading",
      "executor_historical_runs",
      "executor_historical_runs",
      new ObjectLabelMetadata("Executor Historical Run", "Executor Historical Runs")
    );
  }
}
