import { iconRegistry } from "../icons";
import { ObjectMetadata, ObjectLabelMetadata } from "@repo/adricore/metadata";

export class WalletsModel extends ObjectMetadata {
  constructor() {
    super(
      "trading",
      "wallets",
      "wallets",
      new ObjectLabelMetadata("Wallet", "Wallets"),
      iconRegistry.registrations.get("Database")!
    );
  }
}
