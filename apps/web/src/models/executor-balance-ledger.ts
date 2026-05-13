import { iconRegistry } from "./icons";
import { ObjectMetadata, ObjectLabelMetadata } from "@repo/adricore/metadata";

export class ExecutorBalanceLedgerModel extends ObjectMetadata {
  constructor() {
    super(
      "trading",
      "executor_balance_ledger",
      "executor_balance_ledger",
      new ObjectLabelMetadata("Executor Balance Ledger", "Executor Balance Ledgers"),
      iconRegistry.registrations.get("Database")!
    );
  }
}
