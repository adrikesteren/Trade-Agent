import { ObjectMetadataRegistry } from "@repo/adricore/metadata";

import { AssetCoingeckoMetricsModel } from "./asset-coingecko-metrics/asset-coingecko-metrics.object";
import { AssetsModel } from "./assets/assets.object";
import { AutomationActorModel } from "./automation-actor/automation-actor.object";
import { BitvavoSyncRunsModel } from "./bitvavo-sync-runs/bitvavo-sync-runs.object";
import { BitvavoSyncStatusModel } from "./bitvavo-sync-status/bitvavo-sync-status.object";
import { CandlesModel } from "./candles/candles.object";
import { ConnectorsModel } from "./connectors/connectors.object";
import { ExchangeAssetsModel } from "./exchange-assets/exchange-assets.object";
import { ExchangeCandlesModel } from "./exchange-candles/exchange-candles.object";
import { ExchangesModel } from "./exchanges/exchanges.object";
import { MarketsModel } from "./markets/markets.object";
import { LogsModel } from "./logs/logs.object";
import { SystemSettingsModel } from "./system-settings/system-settings.object";
import { TasksModel } from "./tasks/tasks.object";
import { UserPreferencesModel } from "./user-preferences/user-preferences.object";
import { UserProfilesModel } from "./user-profiles/user-profiles.object";

import { ExecutorBalanceLedgerModel } from "./executor-balance-ledger/executor-balance-ledger.object";
import { ExecutorHistoricalRunsModel } from "./executor-historical-runs/executor-historical-runs.object";
import { ExecutorMovingFloorsModel } from "./executor-moving-floors/executor-moving-floors.object";
import { ExecutorsModel } from "./executors/executors.object";
import { FillsModel } from "./fills/fills.object";
import { OrdersModel } from "./orders/orders.object";
import { PositionsModel } from "./positions/positions.object";
import { RiskStateModel } from "./risk-state/risk-state.object";
import { SignalAgentsModel } from "./signal-agents/signal-agents.object";
import { SignalsModel } from "./signals/signals.object";
import { TradeDecisionsModel } from "./trade-decisions/trade-decisions.object";
import { UserExecutionPreferencesModel } from "./user-execution-preferences/user-execution-preferences.object";
import { WalletAssetBalanceModel } from "./wallet-asset-balance/wallet-asset-balance.object";
import { WalletTransactionsModel } from "./wallet-transactions/wallet-transactions.object";
import { WalletsModel } from "./wallets/wallets.object";

import { ScheduleRunsModel } from "./schedule-runs/schedule-runs.object";
import { SchedulesModel } from "./schedules/schedules.object";
import { SignalJobsModel } from "./signal-jobs/signal-jobs.object";
import { SignalRunsModel } from "./signal-runs/signal-runs.object";
import { SyncRunsModel } from "./sync-runs/sync-runs.object";
import { CandleTimestampsModel } from "./candle-timestamps/candle-timestamps.object";

export const objectRegistry = new ObjectMetadataRegistry();

// Initialize all models and add them to the registry
const models = [
  new AssetCoingeckoMetricsModel(),
  new AssetsModel(),
  new AutomationActorModel(),
  new BitvavoSyncRunsModel(),
  new BitvavoSyncStatusModel(),
  new CandlesModel(),
  new ConnectorsModel(),
  new ExchangeAssetsModel(),
  new ExchangeCandlesModel(),
  new ExchangesModel(),
  new MarketsModel(),
  new LogsModel(),
  new SystemSettingsModel(),
  new TasksModel(),
  new UserPreferencesModel(),
  new UserProfilesModel(),
  
  new ExecutorBalanceLedgerModel(),
  new ExecutorHistoricalRunsModel(),
  new ExecutorMovingFloorsModel(),
  new ExecutorsModel(),
  new FillsModel(),
  new OrdersModel(),
  new PositionsModel(),
  new RiskStateModel(),
  new SignalAgentsModel(),
  new SignalsModel(),
  new TradeDecisionsModel(),
  new UserExecutionPreferencesModel(),
  new WalletAssetBalanceModel(),
  new WalletTransactionsModel(),
  new WalletsModel(),

  new ScheduleRunsModel(),
  new SchedulesModel(),
  new SignalJobsModel(),
  new SignalRunsModel(),
  new SyncRunsModel(),
  new CandleTimestampsModel(),
];

models.forEach(model => objectRegistry.add(model));

// Call initialize to establish relationships
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
  return Array.from(objectRegistry.registrations.values()).map(o => o.slug || o.apiName);
}
