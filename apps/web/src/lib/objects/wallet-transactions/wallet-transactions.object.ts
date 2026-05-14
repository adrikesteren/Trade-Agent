import { iconRegistry } from "../icons";
import { ObjectMetadata, ObjectLabelMetadata } from "@repo/adricore/metadata";

export class WalletTransactionsModel extends ObjectMetadata {
  constructor() {
    super(
      "trading",
      "wallet_transactions",
      "wallet_transactions",
      new ObjectLabelMetadata("Wallet Transaction", "Wallet Transactions"),
      iconRegistry.registrations.get("Database")!
    );
  }
}
