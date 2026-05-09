# Trade Mediator — developer- & gebruikersgids

Dit document beschrijft **wat de Trade Mediator in deze repo doet**, welke **grenzen** gelden, **hoe** de worker wordt aangestuurd, en waar de **pure beslislogica** staat. Het vult de productbeschrijving in [how-we-use-agents.md](./how-we-use-agents.md) aan met concrete implementatie en bediening.

**Let op:** “Mediator” is hier **geen** Cursor IDE-assistent en **geen** los LLM-product. Het is een **vast servercomponent**: code die na signalen één **beslissing per gebruiker/markt/gesloten bar** vastlegt in `trading.trade_decisions`. De executor (stap 4) plaats nog geen orders vanuit dit document.

Doelgroep: menselijke ontwikkelaars en **Cursor / automation agents** die deze codebase aanpassen.

---

## Rol in de pipeline

1. **Ingest** schrijft gesloten OHLCV naar `catalog.candles` (opslag-timeframe `5m` — zie `CATALOG_STORAGE_TIMEFRAME` in de webapp).
2. **Signal agents** schrijven advies naar `trading.signals` (`intent`, `confidence`, `reasons`, …). Zij plaatsen **geen** orders.
3. **Trade Mediator** (dit document) leest signalen + **paper**-positie + `trading.risk_state` en **upsert** één rij in `trading.trade_decisions` per `(user_id, market_id, timeframe, close_time)`.
4. **Executor** (toekomst) leest goedgekeurde beslissingen en plaatst orders (paper/live).

---

## Taken die de Mediator **wel** moet doen

- **Signalen lezen** voor de doel-bar: alle rijen in `trading.signals` voor dezelfde `market_id`, `timeframe` en `close_time` (tolerantie ±2s ten opzichte van `closeTimeIso` uit de worker), met join naar `trading.signal_agents` voor het `agent_id`-slug in logs/payload.
- **Positie meenemen (v1: paper):** `trading.positions` voor `(user_id, market_id, paper = true)` — `quantity > 0` betekent “in positie”.
- **Risk state meenemen:** `trading.risk_state` voor `user_id`; `exposure_by_market` wordt voor de risk-check op **symbool** gemapt (o.a. huidige `market_id` → `market_symbol` voor `ProposedOrder.symbol` in `@repo/risk`).
- **Eén geaggregeerde intent** per bar volgens prioriteit (sterkste wint): `**EXIT` > `REDUCE` > `ADD` > `ENTER` > `HOLD`** — zie ook [asset-selection-workflow.md](./asset-selection-workflow.md) (Mediator-beslisvolgorde).
- **Risk rails toepassen** voor nieuwe **koop**-exposure (`ENTER`, en `ADD` alleen als `allowAdd` aan staat): via `evaluateNewEntry` in `[packages/risk](../packages/risk/src/evaluate.ts)`.
- **Beslissing vastleggen:** `approved`, `reason_codes`, `risk_snapshot`, `decision_payload` (o.a. `resolvedIntent`, `signalIds`, `signalsIn`, `proposedOrder` bij approve), optioneel `signal_id` naar de eerste bron-signal.
- **Idempotentie:** upsert op unieke sleutel `(user_id, market_id, timeframe, close_time)` (migratie `20260528120000_trade_decisions_bar_scope.sql`).

---

## Grenzen (wat de Mediator **niet** doet)

- **Geen orders** — geen Bitvavo-calls, geen inserts in `trading.orders` / `trading.fills` vanuit mediator-code.
- **Geen signalen schrijven** — geen wijzigingen aan `trading.signals` vanuit de mediator-worker.
- **Geen onbetrouwbare `user_id`** — zelfde regel als signal agents: alleen UUIDs uit server-trusted env (`SIGNAL_DEFAULT_USER_ID` / `SIGNAL_USER_IDS`). Zie [supabase/RLS-WORKERS.md](../supabase/RLS-WORKERS.md).
- `**EXIT` / `REDUCE` met positie (v1):** worden **geweigerd** met redencodes `exit_not_implemented` / `reduce_not_implemented` tot de executor exits ondersteunt. Zonder positie: `no_position`.

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
- Zonder `SIGNAL_DEFAULT_USER_ID` / `SIGNAL_USER_IDS` worden geen beslissingen geschreven (zelfde users als signalen).

Zelfde **batch + QStash self-chain** als signalen: `[apps/web/src/lib/mediator/run-mediator-catalog-close.ts](../apps/web/src/lib/mediator/run-mediator-catalog-close.ts)`. Zonder QStash + `APP_BASE_URL` draait een **inline drain** in hetzelfde proces (localhost-vriendelijk; let op timeouts bij grote universums).

---

## Worker: `POST /api/workers/mediator-catalog-close`

- **Auth:** QStash-handtekening **of** `Authorization: Bearer ${CRON_SECRET}` (`verifyScheduledWorker`), zie andere workers.
- **Body (JSON):** `{ "closeTimeIso": "<ISO>", "timeframe"?: "5m", "quote"?: "EUR", "marketOffset"?: number, "marketBatchSize"?: number, "candleSyncRunId"?: string }`
- **Gedrag:** voor elke markt in de batch en elke geconfigureerde `user_id`: signalen ophalen → positie → risk → `evaluateTradeDecision` → upsert `trading.trade_decisions`.

Implementatie-entrypoints:

- `[apps/web/src/lib/mediator/run-mediator-catalog-close.ts](../apps/web/src/lib/mediator/run-mediator-catalog-close.ts)`
- `[apps/web/src/lib/mediator/enqueue-mediator-catalog-close.ts](../apps/web/src/lib/mediator/enqueue-mediator-catalog-close.ts)`
- `[apps/web/src/app/api/workers/mediator-catalog-close/route.ts](../apps/web/src/app/api/workers/mediator-catalog-close/route.ts)`

---

## Omgeving variabelen (samenvatting)

Zie ook [apps/web/README.md](../apps/web/README.md#trade-mediator-env) voor tabellen en curl-voorbeelden (localhost-first).


| Variabele                                                                                                                      | Doel                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `SIGNAL_DEFAULT_USER_ID` / `SIGNAL_USER_IDS`                                                                                   | Voor welke gebruikers beslissingen worden weggeschreven (zelfde als signal agents).                                                 |
| `MEDIATOR_AFTER_SIGNALS_DISABLE`                                                                                               | Zet op `1` om de mediator **niet** te starten na de signal-pass.                                                                    |
| `MEDIATOR_RISK_RAILS_JSON`                                                                                                     | Optioneel JSON-object dat de default risk rails overschrijft (o.a. `maxRiskPerTrade`, `maxOpenPositions`, …, optioneel `allowAdd`). |
| `MEDIATOR_DEFAULT_NOTIONAL_EUR`                                                                                                | Voorgestelde ordergrootte (EUR) vóór risk-clamp (default `100`).                                                                    |
| `SIGNALS_CATALOG_CLOSE_MARKET_BATCH_SIZE`, `SIGNALS_CATALOG_CLOSE_MAX_TOTAL_MARKETS`, `SIGNALS_CATALOG_CLOSE_INLINE_MAX_ITERS` | Zelfde batch-limieten als de signal-worker.                                                                                         |


---

## Dashboard & database

- Dashboard: **Trading → Trading Decisions** — `[apps/web/src/app/dashboard/trade-decisions/page.tsx](../apps/web/src/app/dashboard/trade-decisions/page.tsx)`
- Tabel: `trading.trade_decisions` — kolommen o.a. `close_time`, `timeframe`, `paper`, `approved`, `reason_codes`, `risk_snapshot`, `decision_payload`, `signal_id`

---

## Troubleshooting

- **Geen rijen in `trading.trade_decisions`:** controleer `SIGNAL_`* env, of de candle sweep signalen heeft laten schrijven (`signalsUpserted > 0`), of `MEDIATOR_AFTER_SIGNALS_DISABLE` niet `1` is, en of migratie `20260528120000_trade_decisions_bar_scope.sql` is toegepast (unique + `close_time`/`timeframe`).
- **Alleen denied beslissingen met `non_positive_equity`:** vaak ontbreekt een rij in `trading.risk_state` voor die gebruiker — vul realistische `equity_eur` e.d. of seed defaults.
- **Upsert-fouten op unique:** `onConflict` moet overeenkomen met `(user_id, market_id, timeframe, close_time)`.

---

## Instructies voor AI coding agents (Cursor)

- Schrijf **geen** `trade_decisions` vanuit signal-agentcode; alleen de mediator-worker + service role.
- Wijzig je de beslisregels: pas `[packages/trading/src/mediator.ts](../packages/trading/src/mediator.ts)` aan en breid `[mediator.test.ts](../packages/trading/src/mediator.test.ts)` uit; run `pnpm --filter @repo/trading test`.
- Houd workers **deterministisch**; geen `user_id` uit client payloads.

---

*Laatste update: Trade Mediator stap 3 — worker + `@repo/trading`.*