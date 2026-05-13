import { ObjectMetadata, ObjectLabelMetadata } from "@repo/adricore/metadata";

export class SchedulesModel extends ObjectMetadata {
  constructor() {
    super(
      "automation",
      "schedules",
      "schedules",
      new ObjectLabelMetadata("Schedule", "Schedules")
    );
  }
}
