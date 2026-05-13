import { ObjectMetadata, ObjectLabelMetadata } from "@repo/adricore/metadata";

export class UserProfilesModel extends ObjectMetadata {
  constructor() {
    super(
      "public",
      "user_profiles",
      "user_profiles",
      new ObjectLabelMetadata("User Profile", "User Profiles")
    );
  }
}
