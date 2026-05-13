import { iconRegistry } from "./icons";
import { ObjectMetadata, ObjectLabelMetadata, ObjectFieldDataTypes, ObjectRelationshipReferenceTypes } from "@repo/adricore/metadata";

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
    const assetObj = require("./registry").objectRegistry.registrations.get("assets");
    if (assetObj) {
      this.fieldRegistry.add(
        new (require("@repo/adricore/metadata").ObjectFieldMetadata)(
          "base_asset_id",
          "Base Asset",
          ObjectFieldDataTypes.Reference,
          {
            relationship: new (require("@repo/adricore/metadata").ObjectRelationshipMetadata)(
              this,
              "base_asset_id",
              assetObj,
              "markets_by_base_asset",
              ObjectRelationshipReferenceTypes.Lookup
            )
          }
        )
      );

      this.fieldRegistry.add(
        new (require("@repo/adricore/metadata").ObjectFieldMetadata)(
          "quote_asset_id",
          "Quote Asset",
          ObjectFieldDataTypes.Reference,
          {
            relationship: new (require("@repo/adricore/metadata").ObjectRelationshipMetadata)(
              this,
              "quote_asset_id",
              assetObj,
              "markets_by_quote_asset",
              ObjectRelationshipReferenceTypes.Lookup
            )
          }
        )
      );
    }
  }
}
