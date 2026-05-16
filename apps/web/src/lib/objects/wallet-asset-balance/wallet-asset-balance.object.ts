import { iconRegistry } from "../icons";
import { ObjectMetadata, ObjectLabelMetadata } from "@adrikesteren/adricore/metadata";

export class WalletAssetBalanceModel extends ObjectMetadata {
  constructor() {
    super(
      "trading",
      "wallet_asset_balance",
      "wallet_asset_balance",
      new ObjectLabelMetadata("Wallet Asset Balance", "Wallet Asset Balances"),
      iconRegistry.registrations.get("Database")!,
    );
    this.nameField = {
      mode: "autoNumber",
      displayFormat: "WAB-{0000}",
      startNumber: 1,
    };
  }
}
