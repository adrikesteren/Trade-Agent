import { ObjectMetadataRegistry } from "@repo/adricore/metadata";

import { AssetCoingeckoMetricsModel } from "./asset-coingecko-metrics";
import { AssetsModel } from "./assets";
import { AutomationActorModel } from "./automation-actor";
import { BitvavoSyncRunsModel } from "./bitvavo-sync-runs";
import { BitvavoSyncStatusModel } from "./bitvavo-sync-status";
import { CandlesModel } from "./candles";
import { ConnectorsModel } from "./connectors";
import { ExchangeAssetsModel } from "./exchange-assets";
import { ExchangeCandlesModel } from "./exchange-candles";
import { ExchangesModel } from "./exchanges";
import { MarketsModel } from "./markets";
import { LogsModel } from "./logs";
import { SystemSettingsModel } from "./system-settings";
import { TasksModel } from "./tasks";
import { UserPreferencesModel } from "./user-preferences";
import { UserProfilesModel } from "./user-profiles";

import { ExecutorBalanceLedgerModel } from "./executor-balance-ledger";
import { ExecutorHistoricalRunsModel } from "./executor-historical-runs";
import { ExecutorMovingFloorsModel } from "./executor-moving-floors";
import { ExecutorsModel } from "./executors";
import { FillsModel } from "./fills";
import { OrdersModel } from "./orders";
import { PositionsModel } from "./positions";
import { RiskStateModel } from "./risk-state";
import { SignalAgentsModel } from "./signal-agents";
import { SignalsModel } from "./signals";
import { TradeDecisionsModel } from "./trade-decisions";
import { UserExecutionPreferencesModel } from "./user-execution-preferences";
import { WalletAssetBalanceModel } from "./wallet-asset-balance";
import { WalletTransactionsModel } from "./wallet-transactions";
import { WalletsModel } from "./wallets";

import { ScheduleRunsModel } from "./schedule-runs";
import { SchedulesModel } from "./schedules";
import { SignalJobsModel } from "./signal-jobs";
import { SignalRunsModel } from "./signal-runs";
import { CandleTimestampsModel } from "./candle-timestamps";

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
