import { iconRegistry } from "../icons";
import { ObjectMetadata, ObjectLabelMetadata, ObjectFieldDataTypes, ObjectRelationshipReferenceTypes, ObjectRelationshipMetadata, ObjectFieldMetadata } from "@repo/adricore/metadata";
import { objectRegistry } from "../registry";

export class MarketsModel extends ObjectMetadata {
  constructor() {
    super(
      "public",
      "markets",
      "markets",
      new ObjectLabelMetadata("Market", "Markets"),
      iconRegistry.registrations.get("Database")!
    );
  }

  public connectRelationships(): void {
    const assetObj = objectRegistry.registrations.get("assets");
    
    if (assetObj) {
      this.fieldRegistry.add(
        new ObjectFieldMetadata(
          "base_asset_id",
          "Base Asset",
          ObjectFieldDataTypes.Reference,
          {
            sourceObject: this,
            relationship: new ObjectRelationshipMetadata(
              "markets_by_base_asset",
              ObjectRelationshipReferenceTypes.Lookup,
              assetObj
            )
          }
        )
      );

      this.fieldRegistry.add(
        new ObjectFieldMetadata(
          "quote_asset_id",
          "Quote Asset",
          ObjectFieldDataTypes.Reference,
          {
            sourceObject: this,
            relationship: new ObjectRelationshipMetadata(
              "markets_by_quote_asset",
              ObjectRelationshipReferenceTypes.Lookup,
              assetObj
            )
          }
        )
      );
    }
  }
}
