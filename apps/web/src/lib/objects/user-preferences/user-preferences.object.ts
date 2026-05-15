import { iconRegistry } from "../icons";
import { ObjectMetadata, ObjectLabelMetadata } from "@adrikesteren/adricore/metadata";

export class UserPreferencesModel extends ObjectMetadata {
  constructor() {
    super(
      "public",
      "user_preferences",
      "user_preferences",
      new ObjectLabelMetadata("User Preference", "User Preferences"),
      iconRegistry.registrations.get("Database")!,
    );
    this.nameField = {
      mode: "autoNumber",
      displayFormat: "UPR-{0000}",
      startNumber: 1,
    };
  }
}
