import { iconRegistry } from "../icons";
import { ObjectMetadata, ObjectLabelMetadata } from "@repo/adricore/metadata";

export class SignalAgentsModel extends ObjectMetadata {
  constructor() {
    super(
      "trading",
      "signal_agents",
      "signal_agents",
      new ObjectLabelMetadata("Signal Agent", "Signal Agents"),
      iconRegistry.registrations.get("Database")!
    );
  }
}
