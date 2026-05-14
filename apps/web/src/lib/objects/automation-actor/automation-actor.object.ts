import { iconRegistry } from "../icons";
import { ObjectMetadata, ObjectLabelMetadata } from "@repo/adricore/metadata";

export class AutomationActorModel extends ObjectMetadata {
  constructor() {
    super(
      "public",
      "automation_actor",
      "automation_actor",
      new ObjectLabelMetadata("Automation Actor", "Automation Actors"),
      iconRegistry.registrations.get("Database")!,
    );
    this.nameField = {
      mode: "autoNumber",
      displayFormat: "AAC-{0000}",
      startNumber: 1,
    };
  }
}
