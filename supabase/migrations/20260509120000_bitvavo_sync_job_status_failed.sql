-- Add failed lifecycle state for bitvavo_sync_status (alongside running, completed).

alter type public.bitvavo_sync_job_status add value if not exists 'failed';
