import { iconRegistry } from "../icons";
import {
  ObjectFieldDataTypes,
  ObjectFieldMetadata,
  ObjectLabelMetadata,
  ObjectMetadata,
} from "@adrikesteren/adricore/metadata";

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

    // P2 â€” exchange capability flags. Mirrors columns added by
    // 20260723110000_exchange_capabilities.sql. The executor form filters its
    // "allowed sides" choices using these booleans (UI gate); the mediator and
    // executor reject sides outside this set at decision/execution time.
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
