import { ObjectMetadataRegistry } from "@adrikesteren/adricore/metadata";

import { AssetsModel } from "./assets/assets.object";
import { AutomationActorModel } from "./automation-actor/automation-actor.object";
import { ExchangesModel } from "./exchanges/exchanges.object";
import { MarketsModel } from "./markets/markets.object";
import { SystemSettingsModel } from "./system-settings/system-settings.object";
import { TasksModel } from "./tasks/tasks.object";
import { UserPreferencesModel } from "./user-preferences/user-preferences.object";
import { UserProfilesModel } from "./user-profiles/user-profiles.object";

import { DecisionsModel } from "./trade-decisions/trade-decisions.object";
import { ExecutorQuoteAssetBudgetsModel } from "./executor-quote-asset-budgets/executor-quote-asset-budgets.object";
import { ExecutorsModel } from "./executors/executors.object";
import { OrdersModel } from "./orders/orders.object";
import { PositionsModel } from "./positions/positions.object";
import { SignalAgentsModel } from "./signal-agents/signal-agents.object";
import { UserExecutionPreferencesModel } from "./user-execution-preferences/user-execution-preferences.object";
import { WalletAssetBalanceModel } from "./wallet-asset-balance/wallet-asset-balance.object";
import { WalletsModel } from "./wallets/wallets.object";

import { SchedulesModel } from "./schedules/schedules.object";

import { CandleTimestampsModel } from "../high-volume-objects/candle-timestamps/candle-timestamps.object";
import { CandlesModel } from "../high-volume-objects/candles/candles.object";
import { ExecutorHistoricalRunsModel } from "../high-volume-objects/executor-historical-runs/executor-historical-runs.object";
import { ExecutorMovingFloorsModel } from "../high-volume-objects/executor-moving-floors/executor-moving-floors.object";
import { FillsModel } from "../high-volume-objects/fills/fills.object";
import { LogsModel } from "../high-volume-objects/logs/logs.object";
import { ScheduleRunsModel } from "../high-volume-objects/schedule-runs/schedule-runs.object";
import { SignalJobsModel } from "../high-volume-objects/signal-jobs/signal-jobs.object";
import { SignalRunsModel } from "../high-volume-objects/signal-runs/signal-runs.object";
import { SignalsModel } from "../high-volume-objects/signals/signals.object";
import { SyncRunsModel } from "../high-volume-objects/sync-runs/sync-runs.object";
import { WalletTransactionsModel } from "../high-volume-objects/wallet-transactions/wallet-transactions.object";

export const objectRegistry = new ObjectMetadataRegistry();

const models = [
  new AssetsModel(),
  new AutomationActorModel(),
  new ExchangesModel(),
  new MarketsModel(),
  new SystemSettingsModel(),
  new TasksModel(),
  new UserPreferencesModel(),
  new UserProfilesModel(),

  new DecisionsModel(),
  new ExecutorQuoteAssetBudgetsModel(),
  new ExecutorsModel(),
  new OrdersModel(),
  new PositionsModel(),
  new SignalAgentsModel(),
  new UserExecutionPreferencesModel(),
  new WalletAssetBalanceModel(),
  new WalletsModel(),

  new SchedulesModel(),

  new CandleTimestampsModel(),
  new CandlesModel(),
  new ExecutorHistoricalRunsModel(),
  new ExecutorMovingFloorsModel(),
  new FillsModel(),
  new LogsModel(),
  new ScheduleRunsModel(),
  new SignalJobsModel(),
  new SignalRunsModel(),
  new SignalsModel(),
  new SyncRunsModel(),
  new WalletTransactionsModel(),
];

models.forEach((model) => objectRegistry.add(model));

objectRegistry.initialize();

export function getObjectMetadataBySlug(slug: string) {
  for (const obj of Array.from(objectRegistry.registrations.values())) {
    if (obj.slug === slug || obj.apiName === slug) {
      return obj;
    }
  }
  return undefined;
}

export function listRegisteredObjectSlugs(): string[] {
  return Array.from(objectRegistry.registrations.values()).map(
    (o) => o.slug || o.apiName,
  );
}
