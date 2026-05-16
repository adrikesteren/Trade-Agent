import { iconRegistry } from "../icons";
import { ObjectMetadata, ObjectLabelMetadata } from "@adrikesteren/adricore/metadata";

export class WalletsModel extends ObjectMetadata {
  constructor() {
    super(
      "trading",
      "wallets",
      "wallets",
      new ObjectLabelMetadata("Wallet", "Wallets"),
      iconRegistry.registrations.get("Database")!,
    );
    this.nameField = {
      mode: "autoNumber",
      displayFormat: "WAL-{0000}",
      startNumber: 1,
    };
  }
}
