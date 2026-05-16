import { iconRegistry } from "../icons";
import { ObjectMetadata, ObjectLabelMetadata } from "@adrikesteren/adricore/metadata";

export class UserProfilesModel extends ObjectMetadata {
  constructor() {
    super(
      "public",
      "user_profiles",
      "user_profiles",
      new ObjectLabelMetadata("User Profile", "User Profiles"),
      iconRegistry.registrations.get("Database")!,
    );
    this.nameField = {
      mode: "autoNumber",
      displayFormat: "UPF-{0000}",
      startNumber: 1,
    };
  }
}
