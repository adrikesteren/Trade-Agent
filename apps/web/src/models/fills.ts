import { ObjectMetadata, ObjectLabelMetadata } from "@repo/adricore/metadata";

export class FillsModel extends ObjectMetadata {
  constructor() {
    super(
      "trading",
      "fills",
      "fills",
      new ObjectLabelMetadata("Fill", "Fills")
    );
  }
}
