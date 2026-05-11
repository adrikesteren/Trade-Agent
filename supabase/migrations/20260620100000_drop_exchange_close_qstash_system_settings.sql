-- Remove QStash tuning rows (exchange-close now uses Relay; no DB overrides).
delete from public.system_settings
where key in ('exchange_close_qstash_stagger_sec', 'exchange_close_qstash_publish_concurrency');
