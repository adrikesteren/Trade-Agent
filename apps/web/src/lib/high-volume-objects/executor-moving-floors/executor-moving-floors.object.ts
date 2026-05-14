import { iconRegistry } from "../../objects/icons";
import { HighVolumeObjectMetadata, ObjectLabelMetadata } from "@repo/adricore/metadata";

export class ExecutorMovingFloorsModel extends HighVolumeObjectMetadata {
  constructor() {
    super(
      "trading",
      "executor_moving_floors",
      "executor_moving_floors",
      new ObjectLabelMetadata("Executor Moving Floor", "Executor Moving Floors"),
      iconRegistry.registrations.get("Database")!,
    );
  }
}
