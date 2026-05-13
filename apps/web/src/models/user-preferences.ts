import { ObjectMetadata, ObjectLabelMetadata } from "@repo/adricore/metadata";

export class UserPreferencesModel extends ObjectMetadata {
  constructor() {
    super(
      "public",
      "user_preferences",
      "user_preferences",
      new ObjectLabelMetadata("User Preference", "User Preferences")
    );
  }
}
