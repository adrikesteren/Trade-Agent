# Asset Selection Workflow (CoinGecko + Bitvavo)

Dit document beschrijft hoe we van een brede asset-universe naar concrete acties gaan:
`ENTER`, `ADD`, `REDUCE`, `EXIT`, `HOLD`.

Doel: consistente, uitlegbare beslissingen met Bitvavo als execution-venue.

---

## 1) Databronnen en rolverdeling

### Primair voor beslissingen
- **Bitvavo** (execution truth):
  - candles (multi-timeframe),
  - orderboek/spread/depth,
  - tradeability constraints (min order, tick/step size, status),
  - account state (balans, bestaande positie, exposure).

### Context/fundamentals
- **CoinGecko**:
  - market cap, volume, rank, 24h/7d moves, supply, ATH-context,
  - universe discovery en sanity check over assets.

### Waarom niet CoinGecko-only
CoinGecko is sterk voor universe + context, maar mist venue-specifieke execution-kwaliteit op Bitvavo (slippage/spread/depth). Voor live acties is Bitvavo-data leidend.

---

## 2) Universe naar shortlist

We starten met ~430 assets en reduceren in stappen.

### Stap A — Universe seed
- Start met crypto assets in catalog.
- Gebruik CoinGecko om een initiële prioritering te krijgen (bijv. top op market cap/rank).

### Stap B — Hard filters (must pass)
- **Data quality gate**: recente candles + recente CoinGecko refresh.
- **Tradability gate**: actieve Bitvavo market(s), valide constraints.
- **Liquidity gate**: minimale venue-volume/depth, acceptabele spread.
- **Risk gate**: allowlist, kill switch, cooldown, max exposure regels.

### Stap C — Score
Bereken een composite score per asset (0-100), bijvoorbeeld:
- Trend/momentum (40%)
- Liquidity/execution quality (30%)
- Volatility penalty (20%)
- Data confidence/operational quality (10%)

Sortering op score levert een action shortlist.

---

## 3) Actieprioriteit per intent

## `ENTER`
Nieuwe positie openen als er nog geen positie is.

Prioriteit:
1. Regime laat nieuwe longs toe.
2. Signaalconsensus/confidence boven drempel.
3. Hoge liquidity + lage verwachte slippage.
4. Trendbevestiging (geen pure spike-chase).
5. Portfolio diversificatie/correlatie check.
6. Position sizing op basis van risico.

## `ADD`
Bijbouwen op bestaande positie.

Prioriteit:
1. Bestaande trade nog valide (trend intact).
2. Risk budget beschikbaar (max position/concentration).
3. Continuation-signalen blijven sterk.
4. Liquidity check opnieuw voor extra size.
5. Cooldown/time-in-trade respecteren.

## `REDUCE`
Deels afbouwen.

Prioriteit:
1. Risk neemt toe (volatiliteit/drawdown).
2. Signalen verzwakken.
3. Concentratie te hoog.
4. Liquidity verslechtert.
5. Profit-protection of pre-defined scale-out.

## `EXIT`
Volledig sluiten.

Prioriteit:
1. Hard risk trigger (kill switch, max loss, invalidatie).
2. Duidelijke trend/structuurbreuk.
3. Operationele datakwaliteit/venue problemen.
4. Policy/compliance trigger.
5. Time stop (setup faalt binnen expected window).

## `HOLD`
Geen actie.

Gebruik als default wanneer:
- geen high-conviction enter/add/reduce/exit-case bestaat,
- of wanneer transactiekosten/slippage expected edge opeten.

---

## 4) Mediator beslisvolgorde (aanbevolen)

Per asset altijd in deze volgorde evalueren:
1. `EXIT`
2. `REDUCE`
3. `ADD`
4. `ENTER`
5. anders `HOLD`

Reden: downside/risk eerst afhandelen, daarna pas uitbreiding of nieuwe entries.

---

## 5) Praktische tiering voor 430 assets

Aanbevolen start:
- **Tier A (core, ~50 assets)**: volledige set acties (`ENTER/ADD/REDUCE/EXIT/HOLD`).
- **Tier B (satellite, ~100 assets)**: kleinere `ENTER`, beperkt `ADD`, wel `REDUCE/EXIT`.
- **Tier C (rest)**: observatiegericht, in praktijk vooral `HOLD`/`EXIT`.

Dit houdt de pipeline beheersbaar en beperkt execution-risico op illiquide assets.

---

## 6) Minimum data contract per asset (voor decision-ready)

Voor een betrouwbare actie moet minimaal beschikbaar zijn:
- Latest Bitvavo candles (gekozen timeframes),
- Spread/depth of slippage-proxy op Bitvavo,
- CoinGecko fundamentals snapshot (cap/volume/rank),
- Position state (flat/in-position, size, entry, pnl),
- Risk state (budget, drawdown, limits, cooldown).

Ontbreekt een essentieel veld, dan default naar defensief (`HOLD` of lagere size).

---

## 7) Implementatievolgorde (kort)

1. Universe + hard filters.
2. Composite scoring.
3. Action evaluator per intent.
4. Mediator policy/thresholds versioneren.
5. Paper-run evaluatie (hit-rate, drawdown, slippage).
6. Daarna pas live verhogen.

---

Laatste update: workflowvoorstel voor assetselectie met CoinGecko-context en Bitvavo-execution.
