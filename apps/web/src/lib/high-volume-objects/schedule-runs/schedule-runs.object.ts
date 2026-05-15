import { iconRegistry } from "../../objects/icons";
import { HighVolumeObjectMetadata, ObjectLabelMetadata } from "@adrikesteren/adricore/metadata";

export class ScheduleRunsModel extends HighVolumeObjectMetadata {
  constructor() {
    super(
      "automation",
      "schedule_runs",
      "schedule_runs",
      new ObjectLabelMetadata("Schedule Run", "Schedule Runs"),
      iconRegistry.registrations.get("Database")!,
    );
  }
}
