import { ObjectMetadata, ObjectLabelMetadata, ObjectRelationshipMetadata, ObjectRelationshipReferenceTypes, ObjectFieldDataTypes, ObjectFieldMetadata } from "@repo/adricore/metadata";
import { objectRegistry } from "./registry";

export class TradeDecisionsModel extends ObjectMetadata {
  constructor() {
    super(
      "trading",
      "trade_decisions",
      "trade_decisions",
      new ObjectLabelMetadata("Trade Decision", "Trade Decisions")
    );
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
              signalsObject
            )
          }
        )
      );
    }
  }
}
