import { iconRegistry } from "../icons";
import { ObjectMetadata, ObjectLabelMetadata } from "@adrikesteren/adricore/metadata";

export class UserExecutionPreferencesModel extends ObjectMetadata {
  constructor() {
    super(
      "trading",
      "user_execution_preferences",
      "user_execution_preferences",
      new ObjectLabelMetadata("User Execution Preference", "User Execution Preferences"),
      iconRegistry.registrations.get("Database")!,
    );
    this.nameField = {
      mode: "autoNumber",
      displayFormat: "UEP-{0000}",
      startNumber: 1,
    };
  }
}
