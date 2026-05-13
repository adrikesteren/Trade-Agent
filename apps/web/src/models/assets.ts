import { ObjectMetadata, ObjectLabelMetadata } from "@repo/adricore/metadata";

export class AssetsModel extends ObjectMetadata {
  constructor() {
    super(
      "public",
      "assets",
      "assets",
      new ObjectLabelMetadata("Asset", "Assets")
    );
  }
}
