import { iconRegistry } from "../icons";
import { ObjectMetadata, ObjectLabelMetadata } from "@repo/adricore/metadata";

export class ScheduleRunsModel extends ObjectMetadata {
  constructor() {
    super(
      "automation",
      "schedule_runs",
      "schedule_runs",
      new ObjectLabelMetadata("Schedule Run", "Schedule Runs"),
      iconRegistry.registrations.get("Database")!
    );
  }
}
