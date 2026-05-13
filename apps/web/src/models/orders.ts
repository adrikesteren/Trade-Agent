import { ObjectMetadata, ObjectLabelMetadata } from "@repo/adricore/metadata";

export class OrdersModel extends ObjectMetadata {
  constructor() {
    super(
      "trading",
      "orders",
      "orders",
      new ObjectLabelMetadata("Order", "Orders")
    );
  }
}
