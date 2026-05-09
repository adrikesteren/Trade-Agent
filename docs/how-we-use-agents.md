# Hoe we agents gebruiken — rolverdeling

Dit document beschrijft **wie wat doet** in het trading-platform: signal agents, Trade Mediator, executor en ondersteunende workers. Het is bedoeld als referentie voor implementatie en nieuwe chats.

---

## Eerlijk: waarom “agent” zo verwarrend is (én wat jij ermee moet)

**Hetzelfde woord, twee werelden — dat is niet jouw fout.**


| Waar je het leest                 | Wat “agent” dan ongeveer betekent                                                                                                                                                                                |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **In dit document** (Trade Agent) | Een **vast benoemde adviseur** in onze architectuur: code die **alleen een signaal** schrijft (`agent_id` + intent), **geen orders**. Geen claim over LLM, geen hype. Gewoon: *meerdere meningen, één mediator.* |
| **In de samenleving / marketing** | Vaak **geen vaste definitie**: soms “LLM + meerdere stappen + tools”, soms **pure branding** (“Agent-this”, “Agent-that”). Het woord op zich **verklaart niks**.                                                 |


**Wat je praktisch doet:**

1. **Lees je dit repo-doc?** → “Agent” = **kolom in ons ontwerp** (signal producer). Denk: *service die mag roepen, niet mag traden.*
2. **Lees je Twitter, release notes, random vendor?** → Negeer het woord even en vraag (hardop of innerlijk): *“Is dit een model, een workflow, of een productnaam?”* Zonder dat antwoord weet je nog niks.
3. **Wil je het woord niet meer in je hoofd?** → Noem het intern **“signal service”** of **“adviseur”**; `agent_id` blijft gewoon een string in de DB.

**Waarom het soms klinkt alsof we tegenspreken:** in chat over *AI-hype* leggen we “agent” uit als vaag/marketing; in *dit* document gebruiken we het **bewust als korte naam voor één rol**. Dat zijn **twee verschillende gebruiken van hetzelfde woord**, niet twee waarheden die elkaar uitsluiten.

---

## Kernprincipe

- **Meerdere agents adviseren** (signal agents).
- **Eén Trade Mediator beslist** en autoriseert uitvoering.
- **Eén executor** plaats orders (paper of live) — geen eigen strategische keuzes.

Zo voorkom je dat een los agent direct geld riskeert en houd je één plek voor risk, modus en audit.

---

## Rollen in het systeem

### 1. Ingest / market data (meestal geen “AI-agent”)

**Taak:** Betrouwbare marktdata (candles, ticks) ophalen en vastleggen.

- Bitvavo (eerst) via REST en/of websocket.
- Detecteert **candle close** en triggert de pipeline (event: `CANDLE_CLOSED`).
- Schrijft naar database (bijv. Supabase): OHLCV + `close_time`.
- **CoinGecko** (ca. elke 5 minuten, worker + optioneel lokale dev-timer): live USD-velden per catalogus-asset op `public.assets` (`coingecko_market_cap_usd`, volume, FDV, 24h/7d %, rank, supplies, ATH, …; overschreven per sync). `metadata.coingecko_id` wordt waar nodig via `/search` gevuld.

**Output:** feiten over de markt, geen trade-intent.

---

### 2. Signal agents (adviseurs)

**Taak:** Op basis van data een **gestructureerd advies** geven.

- **V1:** vooral **rule-based** (indicatoren, filters) — voorspelbaar en testbaar.
- **Later optioneel:** LLM als hulp (uitleg, research-samenvatting), **niet** als enige reden om te traden tenzij strikt afgeschermd.

**Belangrijk:** signal agents **plaatsen geen orders**. Ze schrijven alleen signalen naar de database (of event bus).

---

### 3. Trade Mediator (beslisser)

**Taak:** Alle signalen + huidige staat van portfolio en risk **samenvoegen** tot één beslissing.

De mediator:

- Leest signalen van toegestane agents voor het symbol/timeframe.
- Kan **live fundamentals** meenemen (kolommen op `assets`, gezet door CoinGecko-sync): market cap/volume/rank helpen context (“illiquid”, “macro cap”) zonder zelf een aparte “fundamentals-agent” te verplichten — policy bepaalt of en hoe dat meetelt.
- Past **operationele modus** toe: `Paper` / `Micro` / `BigSpender`.
- Past **risk rails** toe: daily loss, max posities, allowlist, kill switch, cooldown, enz.
- Kijkt naar **bestaande positie** en **beleid** (zie expliciete signalen hieronder).
- Schrijft **één** `trade_decision` record (approved/denied + redencode + snapshot).

**De mediator “vertaalt” niet blind** `BUY` naar “koop als plat”. Hij volgt **jouw vastgelegde mapping** van signaaltypes naar toegestane acties.

---

### 4. Executor (uitvoerder)

**Taak:** Alleen uitvoeren wat de mediator heeft goedgekeurd.

- Paper: simuleer fill/fees/slippage volgens policy.
- Live: Bitvavo API orders, status bijwerken, reconciliatie.

Geen strategie, geen risk-beslissing — alleen **betrouwbare uitvoering**.

---

### 5. Ops / scheduler (QStash, jobs, Redis)

**Taak:** Betrouwbaarheid op de achtergrond.

- Geplande jobs (candle checks, reconciliatie, dagelijkse risk reset).
- **Redis:** locks, idempotency (“deze candle al verwerkt”), rate limits.
- Alerts bij fouten of kill switch.

---

## Expliciete signalen (aanbevolen)

In plaats van alleen `BUY` / `SELL` gebruiken we **intent** die past bij spot-long en later eventueel andere modi.


| Signaal  | Bedoeling (spot long, typisch)                                           |
| -------- | ------------------------------------------------------------------------ |
| `ENTER`  | Open een long / nieuwe positie (als plat en policy het toelaat).         |
| `ADD`    | Bijbouwen op bestaande long (alleen als expliciet toegestaan in config). |
| `REDUCE` | Deels verkopen (vaste % of stap).                                        |
| `EXIT`   | Positie sluiten (volledig of volgens exit-regels).                       |
| `HOLD`   | Geen actie; wel loggen voor audit.                                       |


**Optioneel later** (alleen als je futures/short ondersteunt): `ENTER_SHORT`, `EXIT_SHORT`, enz. — nu niet nodig voor Bitvavo spot als je alleen long gaat.

### Waarom expliciet?

- `SELL` alleen is dubbelzinnig: exit long vs iets anders.
- `ENTER` / `EXIT` / `REDUCE` maken **positie-logica** duidelijk in code en logs.

---

## Voorbeeld: mediator-logica (conceptueel)

Dit is **geen** volledige implementatie, wel het mentale model:

1. Als `EXIT` of `REDUCE` en **geen positie** → meestal **geen order** (of denied: `NO_POSITION`).
2. Als `ENTER` en **wel positie** → standaard **niet opnieuw kopen** (denied: `ALREADY_IN_POSITION`) tenzij `ADD` expliciet is toegestaan.
3. Als `HOLD` → geen execution; eventueel alleen logging.
4. Altijd: risk checks vóór approval (modus, limits, kill switch).

---

## Samenwerking meerdere signal agents

- Elke agent schrijft **eigen** signalen (bijv. `trend-agent`, `momentum-agent`).
- Mediator gebruikt een **policy**:
  - consensus (alleen `ENTER` als ≥ N agents het eens zijn),
  - of gewogen stem op confidence,
  - of hiërarchie (trend veto’t tegen-trade signalen).

Die policy hoort **versieerbaar** en **getest** (paper/backtest) te zijn.

---

## Waar “AI” past (optioneel)


| Laag          | AI?         | Opmerking                                                               |
| ------------- | ----------- | ----------------------------------------------------------------------- |
| Ingest        | Nee         | Deterministische data.                                                  |
| Signal agents | Optioneel   | Rules first; LLM alleen met strikte output-schema + guardrails.         |
| Mediator      | Meestal nee | Rules + risk; LLM hoogstens voor **mensleesbare uitleg** na beslissing. |
| Executor      | Nee         | API calls + state machine.                                              |


---

## Event flow (samenvatting)

1. `CANDLE_CLOSED` → signal agents draaien → `signals` in DB.
2. Mediator leest signalen + positie + risk → `trade_decision`.
3. Bij approved → executor → `orders` / `fills` (paper of live).
4. Reconciliatie en monitoring op de achtergrond.

---

## `CANDLE_CLOSED` en live charts (concreet in deze repo)

- **Betekenis:** het moment dat een **nieuwe gesloten OHLCV-rij** voor een markt in de catalogus staat — technisch een `**INSERT` of `UPDATE`** op `public.candles` (interval gelijk aan `CATALOG_STORAGE_TIMEFRAME` in `[apps/web/src/lib/markets/chart-types.ts](../apps/web/src/lib/markets/chart-types.ts)`).
- **Geen aparte message-bus voor de dashboard-grafiek:** Realtime volgt de database. Migratie `20250512120000_enable_realtime_candles.sql` voegt `candles` toe aan de publicatie `supabase_realtime`. RLS blijft gelden (`candles_select_all` voor `authenticated`).
- **Market detail:** `[MarketCandleChart](../apps/web/src/components/market-candle-chart.tsx)` opent een Supabase-kanaal met filter `market_id=eq.{uuid}` en vernieuwt na een korte debounce de data via `GET /api/markets/candles` (zodat aggregatie naar hogere timeframes op de server blijft).
- **Server-side signal pipeline:** kan later **extra** een QStash-job publiceren na een candle-write; dat is **niet** nodig voor de live chart.
- **Asset detail (v1):** er is **geen** chart op de asset-pagina, alleen links naar markten. Als daar later een chart komt: overweeg meerdere Realtime-subscriptions (één per `markets.id` voor dit `asset_id`) of één kanaal zonder filter met client-side filter op die id-set.

---

## FAQ: hoe “zet je een agent aan”? (voor nieuwe gebruikers)

### Twee verschillende betekenissen van “agent”


| Context                  | Wat het is                                                                                                                                                  | Subscription?                                                                                                                                                                                                                                  |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Dit trading-platform** | Een **softwarecomponent** (job, worker, functie) die een **gestructureerd signaal** produceert en naar de DB schrijft. Geen los product dat je “abonneert”. | **Nee** voor rule-based agents: dat is gewoon jouw code die draait (cron, QStash, API-route). **Wel** kosten als je een **extern LLM** aanroept (OpenAI, Anthropic, …): dan betaal je via die API, niet via een speciale “agent-subscription”. |
| **Cursor IDE** (editor)  | De **AI-assistent** waarmee je code schrijft (chat, Agent mode).                                                                                            | **Ja**: dat loopt via je **Cursor-plan** (en eventueel eigen API-keys voor bepaalde modellen). Dit staat **los** van je trading-platform.                                                                                                      |


Als je dit document leest voor je **eigen platform**: je hoeft nergens een apart “agent-abonnement” af te sluiten. Je **implementeert** signal agents als code + eventueel DB-kolommen (`agent_id`, policy).

### Hoe sluit je een signal agent praktisch aan?

Hoog niveau (past bij de event flow verderop):

1. **Kies een vaste `agent_id`** (string), bv. `trend-rules`, `momentum-rules`, `news-llm-v1`.
2. **Na `CANDLE_CLOSED`** (of op schedule): jouw code leest marktdata, berekent het advies, schrijft een rij in `**signals**` met die `agent_id`, `action` / intent (`ENTER`, `HOLD`, …), `confidence`, `reasons` (JSON).
3. De **Trade Mediator** leest alleen signalen die in de **policy** staan (allowlist van `agent_id`, gewichten, consensusregels).

Totdat die stappen in code staan, “draait” er nog geen agent — het is geen knop in een externe store.

### Kan elke agent een ander model krijgen?

**Ja, als je dat zelf inricht** — het platform dwingt geen enkel model af.

- **Rule-based agents (aanbevolen voor v1):** geen LLM; “model” is niet van toepassing.
- **LLM-agent:** in je eigen config (env, `agents.yaml`, of DB-tabel) zet je per `agent_id` bv.:
  - `model` (bv. `gpt-4.1-mini` vs `gpt-4.1`),
  - `max_tokens`, temperature,
  - eventueel aparte API key / budget.

De **mediator** hoeft niet te weten welk model je gebruikte; die ziet alleen het **gestructureerde signaal** (en `agent_id` voor policy).

### Voorbeeld: simpele agents op stappen 1–3 en 5, “heavy” op stap 4

Als je de pipeline nummeren zoals in dit document (**ingest → signal agents → mediator → executor → ops**), kun je **per stap** bepalen hoe zwaar de logica is:


| Stap              | Rol                                                                  | Suggestie “eenvoudig vs advanced”                                                                                                    |
| ----------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 1 Ingest          | Data ophalen                                                         | **Geen AI** — deterministisch.                                                                                                       |
| 2 Signal agents   | Adviezen                                                             | **1–3 en 5** (als je meerdere agent-“slots” bedoelt): rule-based / lichte modellen.                                                  |
| 3 Mediator        | Beslissen                                                            | **Meestal rules** (zoals in de tabel “Waar AI past”).                                                                                |
| 4 (jouw “stap 4”) | Bijv. één **research / context**-agent vóór of naast andere signalen | Hier zou je **één** zwaarder LLM-agent kunnen zetten — strikt **JSON output + guardrails**, en de mediator blijft de echte go/no-go. |
| 5 Executor        | Orders                                                               | **Geen AI**.                                                                                                                         |


Concreet: wijs aan **één** `agent_id` (bv. `fundamentals-llm`) een duurder model toe in config; de andere `agent_id`s blijven rules of goedkope modellen. De mediator-policy bepaalt of dat zware signaal überhaupt meetelt (gewicht, veto, consensus).

---

## Gerelateerde documenten

- `trading-platform-project-brief.md` — totale projectcontext en stack (Next.js, Expo, Supabase, Upstash).

---

*Laatste update: concept voor Trade Agent repo — aan te vullen tijdens implementatie (concrete policy JSON, DB-kolommen, agent-id’s).*