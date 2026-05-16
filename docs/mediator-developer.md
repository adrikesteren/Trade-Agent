# Trade Mediator — developer- & gebruikersgids

Dit document beschrijft **wat de Trade Mediator in deze repo doet**, welke **grenzen** gelden, **hoe** de worker wordt aangestuurd, en waar de **pure beslislogica** staat. Het vult de productbeschrijving in [how-we-use-agents.md](./how-we-use-agents.md) aan met concrete implementatie en bediening.

**Let op:** “Mediator” is hier **geen** Cursor IDE-assistent en **geen** los LLM-product. Het is een **vast servercomponent**: code die na signalen één **beslissing per gebruiker/markt/gesloten bar** vastlegt in `trading.trade_decisions`. Orderplaatsing gebeurt in de **executor** (stap 4), niet in de mediator.

Doelgroep: menselijke ontwikkelaars en **Cursor / automation agents** die deze codebase aanpassen.

---

## Rol in de pipeline

1. **Ingest** schrijft gesloten OHLCV naar `catalog.candles` (opslag-timeframe `15m` — zie `CATALOG_STORAGE_TIMEFRAME` in de webapp).
2. **Signal agents** schrijven advies naar `trading.signals` (`intent`, `confidence`, `reasons`, …). Zij plaatsen **geen** orders.
3. **Trade Mediator** (dit document) leest signalen + positie per **executor** (`trading.positions` op `(user_id, executor_id, market_id)`) + **`trading.risk_state` per executor** (`user_id`, `executor_id`) + **risk rails en default-notional op `trading.executors`**, en **upsert** één rij in `trading.trade_decisions` per `(user_id, executor_id, market_id, timeframe, close_time)`. Beslissingen zijn **zonder** `paper`-kolom; paper vs live volgt alleen uit `trading.executors.execution_mode` bij de executor.
4. **Executor** leest goedgekeurde beslissingen en schrijft `orders` / `fills` ([executor-developer.md](./executor-developer.md)).

---

## Taken die de Mediator **wel** moet doen

- **Signalen lezen** voor de doel-bar: alle rijen in `trading.signals` voor dezelfde `market_id`, `timeframe` en `close_time` (tolerantie ±2s ten opzichte van `closeTimeIso` uit de worker), met join naar `trading.signal_agents` voor het `agent_id`-slug in logs/payload.
- **Executors & filters:** alleen **enabled** rijen in `trading.executors` per gebruiker; sla markten over die niet voldoen aan whitelist/blacklist (`catalog.markets.asset_id` vs `executors.filter_asset_ids`).  
- **Positie meenemen:** `trading.positions` voor `(user_id, executor_id, market_id)` — `quantity > 0` betekent “in positie” voor die executor.
- **Risk state meenemen:** typed kolommen op `trading.executors` (o.a. `risk_open_position_count`, `risk_daily_pnl_eur`, `risk_runtime_max_drawdown_eur`, `risk_kill_switch`, `risk_consecutive_losses`) — gelezen door `buildRiskSnapshot` in [catalog-close-mediator-run.service.ts](../apps/web/src/lib/agents/trade-mediator/services/catalog-close-mediator-run.service.ts) en doorgegeven aan `@repo/risk`. De P1-cleanup van mei 2026 heeft de per-symbool exposure-gate (`max_symbol_exposure` + `risk_exposure_by_market` JSON) volledig verwijderd: per-trade sizing wordt al gecapt door `max_risk_per_trade × equity` (risk evaluator) plus `executor_quote_asset_budget.max_notional_primary` (mediator-side), en de JSON-kolom werd nooit bijgewerkt door de trading-flow.
- **Risk rails:** typed kolommen op `trading.executors` (o.a. `max_risk_per_trade`, `daily_loss_limit_eur`, `allow_add`) plus optioneel **`mediator_rails_extra`** (jsonb, merge met dezelfde camelCase-keys als `@repo/risk` / `MediatorRailsConfig`). Zie [`executor-mediator-rails.service.ts`](../apps/web/src/lib/agents/executor/services/executor-mediator-rails.service.ts); beheer in de app onder **Executors**.
- **Notional / quote-asset budget:** per-quote bedragen leven in **`trading.executor_quote_asset_budget`** (één rij per `(executor, quote_asset)`, opgeslagen in primary fiat). De mediator rekent dat per beslissing om naar **quote units** via `asset.dollar_value` ([`fetchExecutorQuoteBudgetInQuoteUnits`](../apps/web/src/lib/agents/executor/services/executor-quote-budget.service.ts)). Markten waarvan de quote **niet** in de junction staat worden geskipt met **`reason_codes=["quote_asset_not_allowed"]`** (rij wordt wel weggeschreven zodat de UI kan tonen waarom er niets is geplaatst). De oude kolom `executors.default_notional_eur` is verwijderd. Zie ook [AGENTS.md → Wallets and quote-asset budgets](../AGENTS.md#wallets-and-quote-asset-budgets).
- **Eén geaggregeerde intent** per bar volgens prioriteit (sterkste wint): **EXIT** > **REDUCE** > **ADD** > **ENTER** > **HOLD** — zie ook [asset-selection-workflow.md](./asset-selection-workflow.md) (Mediator-beslisvolgorde).
- **Risk rails toepassen** voor nieuwe **koop**-exposure (`ENTER`, en `ADD` alleen als `allow_add` op die executor aan staat): via `evaluateNewEntry` in `[packages/risk](../packages/risk/src/evaluate.ts)`.
- **Beslissing vastleggen:** `approved`, `reason_codes`, `risk_snapshot`, `decision_payload` (o.a. `resolvedIntent`, `signalIds`, `signalsIn`, `proposedOrder` bij approve), optioneel `signal_id` naar de eerste bron-signal.
- **Idempotentie:** upsert op unieke sleutel `(user_id, executor_id, market_id, timeframe, close_time)` (migratie `20260530120000_trading_executors.sql`; vervangt de eerdere sleutel zonder `executor_id`).

---

## Grenzen (wat de Mediator **niet** doet)

- **Geen orders** — geen Bitvavo-calls, geen inserts in `trading.orders` / `trading.fills` vanuit mediator-code.
- **Geen signalen schrijven** — geen wijzigingen aan `trading.signals` vanuit de mediator-worker.
- **Geen onbetrouwbare `user_id`** — zelfde regel als signal agents: alleen UUIDs uit **vertrouwde serverbron**: `public.automation_actor` (**Automated Process**) plus optioneel **`SIGNAL_USER_IDS`**. Zie [supabase/RLS-WORKERS.md](../supabase/RLS-WORKERS.md).
- **EXIT** / **REDUCE** met positie (v1): worden **geweigerd** met redencodes `exit_not_implemented` / `reduce_not_implemented` tot de executor exits ondersteunt. Zonder positie: `no_position`.

---

## Phase 3 (P3) — regime gating, position sides & SAR

P3 voegt drie samenhangende lagen toe aan de mediator. De executor kant van het verhaal staat in [executor-developer.md](./executor-developer.md); voor de signal kant zie [signal-agents-developer.md](./signal-agents-developer.md#phase-3-p3-signal-stack--regime-volatility-multi-timeframe-sar).

### Regime gating

- De `regime-classifier-15m-v1` agent zet `metadata.regime` (`bull` / `bear` / `sideways`) op zijn signal-rij. Sinds de wireup van mei 2026 wordt deze agent ook daadwerkelijk gedispatched in zowel live (`signals-catalog-close-run`) als historische replay (`market-close-signal-upsert`) — vóór die wireup bestond alleen de seed-row en zag de mediator nooit een regime signaal. De agent draait op de **daily-aggregated** serie (15m → 1d via [`aggregate-replay-bars.ts`](../apps/web/src/lib/markets/aggregate-replay-bars.ts)); voor historische replays trekt de orchestrator de warmup ver genoeg terug (`computeWarmupBars` → 200 × 96 = 19_200 × 15m bars) zodat de daily SMA(200) vanaf bar 1 nuttig is.
- Per executor schakel je dit in via `mediator_rails_extra.regimeGatingEnabled` (default `false` voor backwards compatibility).
- Als gating aanstaat, demoteert de mediator `ENTER` intents van andere agents naar `HOLD` met `reason_codes` zoals `regime_demote_bear`. EXIT intents blijven altijd staan.
- Sideways regime maakt een uitzondering wanneer `multi-tf-confluence-15m-v1` óók `ENTER` heeft op dezelfde bar — dat overrulet de demotion. De confluence-agent gebruikt zelf de 4h-aggregated serie voor de trendcheck en 15m voor de entry-trigger.
- **Sinds mei 2026**: trend timeframe is configureerbaar via `signal_agents.config.trendTimeframeMinutes` (default seed = `240` = 4h). Voorheen daily × SMA(200) → 200 daily bars (~6.5 mnd) historie nodig; nu 4h × SMA(200) → 200 × 4h ≈ 33 dagen. `catalog.candles` heeft geen TTL meer, dus na voldoende backfill produceert de classifier ook in live-mode echte bull/bear/sideways labels ipv `insufficient_bars`.
- Pure helper: [`regime-gating.service.ts`](../apps/web/src/lib/agents/trade-mediator/services/regime-gating.service.ts).

### Position sides (P2/P3)

- Beslissingen krijgen `position_side` (`long` / `short`) uit `decision_payload.proposedOrder.positionSide`. De unique constraint op `trading.decisions` is per `(user, executor, signal, position_side)` — zo kunnen SAR-paren bestaan voor één onderliggend signal.
- De mediator stamps `position_side` van de gekozen intent; standaard `long` voor pre-P2 / pre-P3 agents.

### Stop-and-Reverse (SAR)

- Op een bevestigde regime flip (`bull→bear→bear` of `bear→bull→bull`, gemeten over de drie laatste regime classifier signalen voor dezelfde markt + user) emitteert de mediator een **paar** decisions op het regime classifier `signal_id`:
  - **EXIT** op de huidige open kant (alleen als er een open positie is).
  - **ENTER** op de tegenovergestelde kant (alleen als die kant in `executor.allowed_sides` staat **en** de markt die kant ondersteunt — zie "Per-market capability gate" hieronder).
- Voor Bitvavo: SAR vuurt het volledige EXIT-long + ENTER-short paar af op een van de 20 shortable EUR-pairs (BTC/ETH/XRP/SOL/ADA/LINK/SUI/DOGE/HBAR/AVAX/TAO/LTC/ONDO/TRX/FET/VET/SHIB/PEPE/XLM/QNT). Op een niet-shortable Bitvavo markt skipt de mediator de ENTER-short met `reason_codes=["side_not_supported_by_market"]` en blijft alleen de EXIT-long over.
- De executor ontvangt deze beslissingen en verwerkt ze in **EXIT-before-ENTER** volgorde per `(executor, market, bar)` — kritisch voor wallet-sequencing.
- Helpers: [`regime-flip-detect.service.ts`](../apps/web/src/lib/agents/trade-mediator/services/regime-flip-detect.service.ts), [`sar-decision-emit.service.ts`](../apps/web/src/lib/agents/trade-mediator/services/sar-decision-emit.service.ts), [`sar-mediator-run.service.ts`](../apps/web/src/lib/agents/trade-mediator/services/sar-mediator-run.service.ts).

### Per-market capability gate

Capability flags (`supports_spot_buy`, `supports_spot_sell`, `supports_margin_long`, `supports_margin_short`) leven op `catalog.markets`, met een rollup-view `catalog.v_exchange_capabilities` voor exchange-level form-gating. De mediator gebruikt de **per-market** flags als defense-in-depth: zelfs als de executor `allowed_sides=['long']` heeft, schrijft de mediator een skip-decision (`reason_codes=["side_not_supported_by_market"]`) als de specifieke markt geen `supports_spot_buy || supports_margin_long` heeft. Helper: [`fetchMarketCapabilitiesByMarketIds` + `marketSupportsSide`](../apps/web/src/lib/catalog/market-capabilities.ts). De executor doet dezelfde check vóór hij een order plaatst en rejected de order met reason `position_side_not_supported_by_market` als de mediator-gate werd omzeild (bijv. via een handmatige replay of import).
- Audit: het `decision_payload` van een SAR-rij bevat `sarFlip = { fromRegime, toRegime, confirmedAtBar }` en `sarReason = sar_exit_old_side` / `sar_enter_new_side`.

### Configuratie samenvatting per executor

Op `trading.executors.mediator_rails_extra` (jsonb):

| Key | Default | Effect |
| --- | --- | --- |
| `regimeGatingEnabled` | `false` | Schakelt regime gating in (zie boven). |
| (overige rails uit `MediatorRailsConfig`) | per `@repo/risk` | Risk rails: `maxRiskPerTrade`, `dailyLossLimitEur`, etc. |

Op `trading.executors`:

| Kolom | Effect |
| --- | --- |
| `allowed_sides` (`text[]`) | Welke `position_side` waardes deze executor mag handelen. SAR ENTER skipt zwijgend als opposite side ontbreekt. |
| `wallet_id` (P1) | Per-executor pointer naar `trading.wallets` (shared per `(user, exchange)` voor live/paper, isolated voor historical). |

---

## Pure beslislogica (`@repo/trading`)

De regels zijn **deterministisch** en unit-testbaar:

- Bestand: `[packages/trading/src/mediator.ts](../packages/trading/src/mediator.ts)`
- API: `aggregateSignalIntents`, `evaluateTradeDecision`
- Tests: `[packages/trading/src/mediator.test.ts](../packages/trading/src/mediator.test.ts)` — run: `pnpm --filter @repo/trading test`

Kort overzicht van uitkomsten (niet exhaustief):


| Situatie                                    | `approved` | Typische `reason_codes`                                                        |
| ------------------------------------------- | ---------- | ------------------------------------------------------------------------------ |
| Geen signalen voor de bar                   | `false`    | `no_signals`                                                                   |
| Geaggregeerde intent `HOLD`                 | `false`    | `hold_intent`                                                                  |
| `ENTER` maar al in positie                  | `false`    | `already_in_position`                                                          |
| `ENTER` flat + risk OK                      | `true`     | `[]` + `proposedOrder` (buy)                                                   |
| `ADD` zonder positie                        | `false`    | `no_position`                                                                  |
| `ADD` met positie, `allowAdd` uit (default) | `false`    | `add_not_enabled`                                                              |
| Risk gate faalt                             | `false`    | o.a. `kill_switch`, `daily_loss_limit`, `max_open_positions`, … (`@repo/risk`) |


---

## Wanneer draait de mediator?

- Na de **laatste batch** van `POST /api/workers/signals-catalog-close` voor een gegeven `closeTimeIso`, **als** in die laatste batch minstens één signal-upsert is gelukt (`signalsUpserted > 0`), start de app automatisch de mediator-run (tenzij `MEDIATOR_AFTER_SIGNALS_DISABLE=1`).
- Zonder geldige pipeline-gebruikers (geen **Automated Process** in `automation_actor` én geen bruikbare `SIGNAL_USER_IDS`) worden geen beslissingen geschreven (zelfde users als signalen).
- Na de **laatste batch** van `mediator-catalog-close` met `decisionsUpserted > 0` start de **executor** (`POST /api/workers/executor-catalog-close`), tenzij `EXECUTOR_AFTER_MEDIATOR_DISABLE=1`. Zie [executor-developer.md](./executor-developer.md).

Zelfde **batch + inline drain** als signalen: `[apps/web/src/lib/mediator/run-mediator-catalog-close.ts](../apps/web/src/lib/mediator/run-mediator-catalog-close.ts)` verwerkt alle markten in hetzelfde proces (let op timeouts bij grote universums; zie `SIGNALS_CATALOG_CLOSE_*` env).

---

## Worker: `POST /api/workers/mediator-catalog-close`

- **Auth:** `Authorization: Bearer ${CRON_SECRET}` (`verifyScheduledWorker`).
- **Body (JSON):** `{ "closeTimeIso": "<ISO>", "timeframe"?: "15m", "quote"?: "EUR", "marketOffset"?: number, "marketBatchSize"?: number, "candleSyncRunId"?: string, "signalsSyncRunId"?: string }` (sync-run ids zijn optioneel; de worker start desnoods een nieuwe `mediator_catalog_close` run).
- **Gedrag:** voor elke markt in de batch, elke geconfigureerde `user_id`, en elke **enabled executor** van die gebruiker (asset-filter toegepast): signalen ophalen → `risk_state` voor die executor → positie op dat executor-boek → rails/notional van die executor-rij → `evaluateTradeDecision` → upsert `trading.trade_decisions`.

Implementatie-entrypoints:

- `[apps/web/src/lib/mediator/run-mediator-catalog-close.ts](../apps/web/src/lib/mediator/run-mediator-catalog-close.ts)`
- `[apps/web/src/lib/mediator/enqueue-mediator-catalog-close.ts](../apps/web/src/lib/mediator/enqueue-mediator-catalog-close.ts)`
- `[apps/web/src/app/api/workers/mediator-catalog-close/route.ts](../apps/web/src/app/api/workers/mediator-catalog-close/route.ts)`

---

## Omgeving variabelen (samenvatting)

Zie ook [apps/web/README.md](../apps/web/README.md#trade-mediator-env) voor tabellen en curl-voorbeelden (localhost-first).


| Variabele                                                                                                                      | Doel                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `SIGNAL_USER_IDS`                                                                                                              | Optioneel: extra `auth.users`-UUID’s naast **Automated Process** uit `automation_actor` (zelfde pipeline als signalen).          |
| `MEDIATOR_AFTER_SIGNALS_DISABLE`                                                                                               | Zet op `1` om de mediator **niet** te starten na de signal-pass.                                                                    |
| ~~`MEDIATOR_RISK_RAILS_JSON`~~ / ~~`MEDIATOR_DEFAULT_NOTIONAL_EUR`~~                                                           | **Verouderd** — rails en default-notional staan op **`trading.executors`** (app **Executors**).                               |
| `SIGNALS_CATALOG_CLOSE_MARKET_BATCH_SIZE`, `SIGNALS_CATALOG_CLOSE_MAX_TOTAL_MARKETS`, `SIGNALS_CATALOG_CLOSE_INLINE_MAX_ITERS` | Zelfde batch-limieten als de signal-worker.                                                                                         |


---

## App UI & database

- **Trading → Trading Decisions** — `[apps/web/src/app/(app)/trade-decisions/page.tsx](../apps/web/src/app/(app)/trade-decisions/page.tsx)`
- Tabel: `trading.trade_decisions` — kolommen o.a. `executor_id`, `close_time`, `timeframe`, `approved`, `reason_codes`, `risk_snapshot`, `decision_payload`, `signal_id`

---

## Troubleshooting

- **Geen rijen in `trading.trade_decisions`:** controleer `public.automation_actor` / optioneel `SIGNAL_USER_IDS`, of de candle sweep signalen heeft laten schrijven (`signalsUpserted > 0`), of `MEDIATOR_AFTER_SIGNALS_DISABLE` niet `1` is, of er minstens één **enabled** `trading.executors`-rij is voor die gebruiker, en of migraties t/m `20260530120000_trading_executors.sql` zijn toegepast (unique met `executor_id`).
- **Alleen denied beslissingen met `non_positive_equity` / `invalid_notional`:** controleer dat de executor's wallet een positief saldo heeft voor de **quote asset** van de markt (zie [executor-developer.md → Executor balance](./executor-developer.md#executor-balance--assigned-capital-per-asset-per-wallet)) en dat `max_risk_per_trade` redelijk staat op `trading.executors`.
- **Alleen denied met `quote_asset_not_allowed`:** voor `(executor, market.quote_asset_id)` ontbreekt een rij in `trading.executor_quote_asset_budget`. Voeg via **Executors → Edit → Quote-asset budgets** een rij toe (bedrag in primary fiat).
- **Upsert-fouten op unique:** `onConflict` moet overeenkomen met `(user_id, executor_id, market_id, timeframe, close_time)`.

---

## Instructies voor AI coding agents (Cursor)

- Schrijf **geen** `trade_decisions` vanuit signal-agentcode; alleen de mediator-worker + service role.
- Wijzig je de beslisregels: pas `[packages/trading/src/mediator.ts](../packages/trading/src/mediator.ts)` aan en breid `[mediator.test.ts](../packages/trading/src/mediator.test.ts)` uit; run `pnpm --filter @repo/trading test`.
- Houd workers **deterministisch**; geen `user_id` uit client payloads.

---

*Laatste update: P1 (Trading framework v2) — quote-asset budgets vervangen `default_notional_eur`; wallets per `(user, exchange)` voor live/paper, isolated per historische executor.*