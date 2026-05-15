import { iconRegistry } from "../icons";
import { ObjectMetadata, ObjectLabelMetadata, ObjectRelationshipMetadata, ObjectRelationshipReferenceTypes, ObjectFieldDataTypes, ObjectFieldMetadata } from "@adrikesteren/adricore/metadata";
import { objectRegistry } from "../registry";

export class ExecutorsModel extends ObjectMetadata {
  constructor() {
    super(
      "trading",
      "executors",
      "executors",
      new ObjectLabelMetadata("Executor", "Executors"),
      iconRegistry.registrations.get("Database")!,
    );
    this.nameField = { mode: "manual" };
  }

  public connectRelationships(): void {
    const walletsObject = objectRegistry.registrations.get("wallets");
    
    if (walletsObject) {
      this.fieldRegistry.add(
        new ObjectFieldMetadata(
          "wallet_id",
          "Wallet",
          ObjectFieldDataTypes.Reference,
          {
            sourceObject: this,
            relationship: new ObjectRelationshipMetadata(
              "executors",
              ObjectRelationshipReferenceTypes.Lookup,
              walletsObject
            )
          }
        )
      );
    }
  }
}
