import { iconRegistry } from "../icons";
import {
  ObjectMetadata,
  ObjectLabelMetadata,
  ObjectRelationshipMetadata,
  ObjectRelationshipReferenceTypes,
  ObjectFieldDataTypes,
  ObjectFieldMetadata,
} from "@adrikesteren/adricore/metadata";
import { objectRegistry } from "../registry";

/**
 * `trading.decisions` (renamed from `trade_decisions` in
 * `20260714100000_wallets_replace_ledger_risk_decisions.sql`).
 *
 * The class, apiName and slug stay `trade_decisions` to keep the public URL
 * `/trade-decisions/...` and lookup-by-slug call sites working; only the
 * physical `table` is updated to the new name.
 */
export class DecisionsModel extends ObjectMetadata {
  constructor() {
    super(
      "trading",
      "decisions",
      "trade_decisions",
      new ObjectLabelMetadata("Trade Decision", "Trade Decisions"),
      iconRegistry.registrations.get("Database")!,
    );
    this.nameField = {
      mode: "autoNumber",
      displayFormat: "DEC-{0000}",
      startNumber: 1,
    };
  }

  public connectRelationships(): void {
    const signalsObject = objectRegistry.registrations.get("signals");

    if (signalsObject) {
      this.fieldRegistry.add(
        new ObjectFieldMetadata(
          "signal_id",
          "Signal",
          ObjectFieldDataTypes.Reference,
          {
            sourceObject: this,
            relationship: new ObjectRelationshipMetadata(
              "trade_decisions",
              ObjectRelationshipReferenceTypes.Lookup,
              signalsObject,
            ),
          },
        ),
      );
    }
  }
}
