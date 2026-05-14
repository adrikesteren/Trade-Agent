import { iconRegistry } from "../../objects/icons";
import { HighVolumeObjectMetadata, ObjectLabelMetadata } from "@repo/adricore/metadata";

export class SignalsModel extends HighVolumeObjectMetadata {
  constructor() {
    super(
      "trading",
      "signals",
      "signals",
      new ObjectLabelMetadata("Signal", "Signals"),
      iconRegistry.registrations.get("Database")!,
    );
  }
}
