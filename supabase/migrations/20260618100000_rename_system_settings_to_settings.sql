-- Rename automation.system_settings → automation.settings (qualified name stays under automation schema).

alter table if exists automation.system_settings rename to settings;

-- Index created in 20260617110000_automation_system_settings.sql
alter index if exists automation.system_settings_updated_idx rename to settings_updated_idx;
