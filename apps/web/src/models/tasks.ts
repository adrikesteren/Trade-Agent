import { iconRegistry } from "./icons";
import { ObjectMetadata, ObjectLabelMetadata } from "@repo/adricore/metadata";

export class TasksModel extends ObjectMetadata {
  constructor() {
    super(
      "public",
      "tasks",
      "tasks",
      new ObjectLabelMetadata("Task", "Tasks"),
      iconRegistry.registrations.get("Database")!
    );
  }
}
