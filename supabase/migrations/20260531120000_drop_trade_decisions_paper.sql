-- Trade decisions are mode-agnostic; paper vs live is determined by trading.executors at execution time.

alter table trading.trade_decisions drop column if exists paper;
