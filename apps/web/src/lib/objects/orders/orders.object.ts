import { iconRegistry } from "../icons";
import { ObjectMetadata, ObjectLabelMetadata } from "@repo/adricore/metadata";

export class OrdersModel extends ObjectMetadata {
  constructor() {
    super(
      "trading",
      "orders",
      "orders",
      new ObjectLabelMetadata("Order", "Orders"),
      iconRegistry.registrations.get("Database")!,
    );
    this.nameField = {
      mode: "autoNumber",
      displayFormat: "ORD-{0000}",
      startNumber: 1,
    };
  }
}
