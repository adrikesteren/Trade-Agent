import { iconRegistry } from "../icons";
import { ObjectLabelMetadata, ObjectMetadata } from "@repo/adricore/metadata";

export class ExchangesModel extends ObjectMetadata {
  constructor() {
    super(
      "catalog",
      "exchanges",
      "exchanges",
      new ObjectLabelMetadata("Exchange", "Exchanges"),
      iconRegistry.registrations.get("Database")!,
    );
    this.nameField = { mode: "manual" };

    // Capability flags moved to `catalog.markets` per market (see
    // 20260724000000_market_capabilities.sql). The exchange-level rollup
    // lives in `catalog.v_exchange_capabilities` and is consumed by the
    // executor form's "Trading stance" picker. No field metadata here:
    // the columns no longer exist on this table.
  }
}
