import Link from "next/link";

export function SignalsToPositionArticle() {
  return (
    <article className="space-y-8 text-sm leading-relaxed">
      <p className="bk-text-muted">
        Dit artikel beschrijft de <strong>huidige</strong> keten in deze codebase: van gesloten candles tot
        vastgelegde posities, per gebruiker en per <strong>executor</strong> (paper of live portfolio).
      </p>

      <section className="space-y-3">
        <h2 className="text-base font-semibold tracking-tight">Overzicht</h2>
        <pre className="bk-card overflow-x-auto p-4 font-mono text-xs leading-6">
          {`catalog.candles (ingest)
       → signal workers → trading.signals
       → mediator-catalog-close → trading.trade_decisions
       → executor-catalog-close → trading.orders (+ fills)
       → trading.positions (+ risk_state / ledger)`}
        </pre>
        <p>
          Geen enkele stap “tradet direct”: signal agents schrijven alleen advies; de{" "}
          <strong>Trade Mediator</strong> keurt af of toe; de <strong>executor</strong> zet goedgekeurde
          beslissingen om in orders (paper-simulatie of Bitvavo REST).
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold tracking-tight">1. Marktdata en candles</h2>
        <ul className="bk-text-muted list-inside list-disc space-y-2">
          <li>
            OHLCV staat in <code className="bk-code">catalog.candles</code> (opslag-timeframe typisch{" "}
            <code className="bk-code">5m</code>), met <code className="bk-code">close_time</code> per bar.
          </li>
          <li>
            Workers draaien rond <strong>candle close</strong> (gepland via QStash naar je publieke dev-URL
            op localhost, of handmatige “Sync now” / worker-calls — zie README onder webapp).
          </li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold tracking-tight">2. Signal agents → signalen</h2>
        <ul className="bk-text-muted list-inside list-disc space-y-2">
          <li>
            <strong>Signal agents</strong> zijn geconfigureerde adviseurs; ze schrijven rijen naar{" "}
            <code className="bk-code">trading.signals</code> (o.a. intent zoals ENTER / HOLD, confidence,
            redenen). Ze plaatsen <strong>geen</strong> orders.
          </li>
          <li>
            In het dashboard:{" "}
            <Link href="/dashboard/signal-agents" className="bk-link">
              Signal Agents
            </Link>
            ,{" "}
            <Link href="/dashboard/signals" className="bk-link">
              Signals
            </Link>
            .
          </li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold tracking-tight">3. Trade Mediator → trade decisions</h2>
        <p className="bk-text-muted">
          Worker: <code className="bk-code">POST /api/workers/mediator-catalog-close</code>. De mediator
          leest signalen voor dezelfde markt, timeframe en bar-sluiting (met kleine tijdtolerantie), en
          voegt <strong>positie</strong> en <strong>risk</strong> per executor toe.
        </p>
        <ul className="bk-text-muted list-inside list-disc space-y-2">
          <li>
            Alleen <strong>enabled</strong> executors worden meegenomen. Per executor geldt een{" "}
            <strong>asset filter</strong> (alle / whitelist / blacklist op{" "}
            <code className="bk-code">catalog.markets.asset_id</code>).
          </li>
          <li>
            Signalen worden geaggregeerd tot één intent per bar volgens vaste prioriteit:{" "}
            <strong>EXIT &gt; REDUCE &gt; ADD &gt; ENTER &gt; HOLD</strong> (sterkste wint binnen die laag
            waar van toepassing).
          </li>
          <li>
            Risk rails komen van de executor-rij: o.a. <code className="bk-code">default_notional_eur</code>,{" "}
            <code className="bk-code">max_risk_per_trade</code>, <code className="bk-code">max_open_positions</code>
            , daily loss / drawdown, <code className="bk-code">allow_add</code>, optioneel{" "}
            <code className="bk-code">mediator_rails_extra</code> (JSON overrides).
          </li>
          <li>
            Output: één upsert op <code className="bk-code">trading.trade_decisions</code> per (
            <code className="bk-code">user_id</code>, <code className="bk-code">executor_id</code>,{" "}
            <code className="bk-code">market_id</code>, <code className="bk-code">timeframe</code>,{" "}
            <code className="bk-code">close_time</code>) met <code className="bk-code">approved</code>,{" "}
            <code className="bk-code">reason_codes</code>, <code className="bk-code">risk_snapshot</code> en{" "}
            <code className="bk-code">decision_payload</code> (o.a. <code className="bk-code">proposedOrder</code>{" "}
            bij approve voor koop-intents).
          </li>
          <li>
            Dashboard:{" "}
            <Link href="/dashboard/trade-decisions" className="bk-link">
              Trade Decisions
            </Link>
            ,{" "}
            <Link href="/dashboard/executors" className="bk-link">
              Executors
            </Link>
            ,{" "}
            <Link href="/dashboard/risk-state" className="bk-link">
              Risk State
            </Link>
            .
          </li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold tracking-tight">4. Goedgekeurd is nog geen order</h2>
        <p className="bk-text-muted">
          Een rij met <code className="bk-code">approved = true</code> en intent ENTER (of ADD met policy){" "}
          betekent: de mediator heeft risico gecontroleerd en een <strong>voorgestelde koop</strong> vastgelegd.
          De <strong>executor</strong> draait in een <strong>aparte worker-pass</strong> en kan alsnog
          overslaan (saldo, ontbrekende candle-prijs in paper, geen geldige{" "}
          <code className="bk-code">proposedOrder</code>, of al een order voor die{" "}
          <code className="bk-code">decision_id</code>).
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold tracking-tight">5. Executor → orders, fills, posities</h2>
        <p className="bk-text-muted">
          Worker: <code className="bk-code">POST /api/workers/executor-catalog-close</code>. Paper vs live
          volgt uit <code className="bk-code">trading.executors.execution_mode</code> op het moment van
          uitvoering (beslissingen zelf zijn mode-agnostisch).
        </p>
        <ul className="bk-text-muted list-inside list-disc space-y-2">
          <li>
            <strong>Paper</strong>: fill op catalog candle-<strong>close</strong> van die bar, gesimuleerde
            fee, debiteert <code className="bk-code">risk_state.equity_eur</code> via de ledger-RPCs; bij
            onvoldoende saldo wordt <strong>geen</strong> order ingevoegd.
          </li>
          <li>
            <strong>Live</strong>: pre-check op toegewezen EUR-saldo; bij tekort wordt een order met status{" "}
            <code className="bk-code">rejected</code> gezet zonder Bitvavo-call; anders market buy op
            Bitvavo, daarna fills/positie en debitering.
          </li>
          <li>
            Idempotentie: maximaal <strong>één</strong> order per <code className="bk-code">decision_id</code>{" "}
            (partial unique index).
          </li>
          <li>
            <code className="bk-code">trading.positions</code> is keyed op (
            <code className="bk-code">user_id</code>, <code className="bk-code">executor_id</code>,{" "}
            <code className="bk-code">market_id</code>).
          </li>
          <li>
            Dashboard:{" "}
            <Link href="/dashboard/orders" className="bk-link">
              Orders
            </Link>
            ,{" "}
            <Link href="/dashboard/fills" className="bk-link">
              Fills
            </Link>
            ,{" "}
            <Link href="/dashboard/positions" className="bk-link">
              Positions
            </Link>
            .
          </li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold tracking-tight">6. Wanneer draait de executor?</h2>
        <p className="bk-text-muted">
          Na de <strong>laatste batch</strong> van <code className="bk-code">mediator-catalog-close</code>{" "}
          voor een bar — als er in die run daadwerkelijk beslissingen zijn ge-upsert — wordt de executor-run
          ingepland (QStash naar je publieke base URL) of inline gedraind als er geen QStash is. Zet{" "}
          <code className="bk-code">EXECUTOR_AFTER_MEDIATOR_DISABLE=1</code> om die automatische keten uit te
          zetten; je kunt de executor-worker dan handmatig aanroepen (zie{" "}
          <code className="bk-code">apps/web/README.md</code>).
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold tracking-tight">7. Saldo en executors</h2>
        <p className="bk-text-muted">
          Besteedbaar saldo per executor zit in <code className="bk-code">trading.risk_state.equity_eur</code>{" "}
          (toegewezen EUR via het executor-detail scherm, niet het volledige Bitvavo-tegoed). Zonder
          toegewezen saldo kan een goedgekeurde ENTER niet als paper/live buy worden uitgevoerd zoals
          hierboven beschreven.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold tracking-tight">Verder lezen (repo)</h2>
        <p className="bk-text-muted">
          Diepgaandere technische details staan in de markdown onder <code className="bk-code">docs/</code>{" "}
          in de repository, o.a. <code className="bk-code">mediator-developer.md</code>,{" "}
          <code className="bk-code">executor-developer.md</code> en{" "}
          <code className="bk-code">how-we-use-agents.md</code>.
        </p>
      </section>
    </article>
  );
}
