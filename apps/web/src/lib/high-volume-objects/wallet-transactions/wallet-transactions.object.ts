import { iconRegistry } from "../../objects/icons";
import { HighVolumeObjectMetadata, ObjectLabelMetadata } from "@repo/adricore/metadata";

export class WalletTransactionsModel extends HighVolumeObjectMetadata {
  constructor() {
    super(
      "trading",
      "wallet_transactions",
      "wallet_transactions",
      new ObjectLabelMetadata("Wallet Transaction", "Wallet Transactions"),
      iconRegistry.registrations.get("Database")!,
    );
  }
}
