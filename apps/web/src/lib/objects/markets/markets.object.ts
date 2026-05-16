import { iconRegistry } from "../icons";
import {
  ObjectMetadata,
  ObjectLabelMetadata,
  ObjectFieldDataTypes,
  ObjectRelationshipReferenceTypes,
  ObjectRelationshipMetadata,
  ObjectFieldMetadata,
} from "@repo/adricore/metadata";
import { objectRegistry } from "../registry";

export class MarketsModel extends ObjectMetadata {
  constructor() {
    super(
      "catalog",
      "markets",
      "markets",
      new ObjectLabelMetadata("Market", "Markets"),
      iconRegistry.registrations.get("Database")!,
    );
    this.nameField = {
      mode: "formula",
      description: "base_asset.code + '-' + quote_asset.code",
      compute: (record) => {
        const base = (record["base_asset"] as { code?: unknown } | undefined)?.code;
        const quote = (record["quote_asset"] as { code?: unknown } | undefined)?.code;
        const baseStr = base != null && String(base).trim() !== "" ? String(base) : "?";
        const quoteStr = quote != null && String(quote).trim() !== "" ? String(quote) : "?";
        return `${baseStr}-${quoteStr}`;
      },
    };
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
              assetObj,
            ),
          },
        ),
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
              assetObj,
            ),
          },
        ),
      );
    }

    // Per-market capability flags (see 20260724000000_market_capabilities.sql).
    // Surface them in the market list/detail so users can audit which markets
    // accept which sides without dropping into SQL.
    this.fieldRegistry.add(
      new ObjectFieldMetadata("supports_spot_buy", "Supports spot buy", ObjectFieldDataTypes.Boolean, {
        sourceObject: this,
      }),
    );
    this.fieldRegistry.add(
      new ObjectFieldMetadata("supports_spot_sell", "Supports spot sell", ObjectFieldDataTypes.Boolean, {
        sourceObject: this,
      }),
    );
    this.fieldRegistry.add(
      new ObjectFieldMetadata("supports_margin_long", "Supports margin long", ObjectFieldDataTypes.Boolean, {
        sourceObject: this,
      }),
    );
    this.fieldRegistry.add(
      new ObjectFieldMetadata("supports_margin_short", "Supports margin short", ObjectFieldDataTypes.Boolean, {
        sourceObject: this,
      }),
    );
  }
}
