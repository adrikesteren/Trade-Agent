import { iconRegistry } from "./icons";
import { ObjectMetadata, ObjectLabelMetadata } from "@repo/adricore/metadata";

export class ExecutorMovingFloorsModel extends ObjectMetadata {
  constructor() {
    super(
      "trading",
      "executor_moving_floors",
      "executor_moving_floors",
      new ObjectLabelMetadata("Executor Moving Floor", "Executor Moving Floors"),
      iconRegistry.registrations.get("Database")!
    );
  }
}
