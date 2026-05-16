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

export class ExecutorQuoteAssetBudgetsModel extends ObjectMetadata {
  constructor() {
    super(
      "trading",
      "executor_quote_asset_budget",
      "executor_quote_asset_budgets",
      new ObjectLabelMetadata(
        "Executor quote-asset budget",
        "Executor quote-asset budgets",
      ),
      iconRegistry.registrations.get("Database")!,
    );
    this.nameField = {
      mode: "autoNumber",
      displayFormat: "EQB-{0000}",
      startNumber: 1,
    };
  }

  public connectRelationships(): void {
    const executorsObject = objectRegistry.registrations.get("executors");
    const assetsObject = objectRegistry.registrations.get("assets");

    if (executorsObject) {
      this.fieldRegistry.add(
        new ObjectFieldMetadata(
          "executor_id",
          "Executor",
          ObjectFieldDataTypes.Reference,
          {
            sourceObject: this,
            relationship: new ObjectRelationshipMetadata(
              "executor_quote_asset_budgets",
              ObjectRelationshipReferenceTypes.MasterDetail,
              executorsObject,
            ),
          },
        ),
      );
    }

    if (assetsObject) {
      this.fieldRegistry.add(
        new ObjectFieldMetadata(
          "quote_asset_id",
          "Quote asset",
          ObjectFieldDataTypes.Reference,
          {
            sourceObject: this,
            relationship: new ObjectRelationshipMetadata(
              "executor_quote_asset_budgets_quote",
              ObjectRelationshipReferenceTypes.Lookup,
              assetsObject,
            ),
          },
        ),
      );
    }
  }
}
