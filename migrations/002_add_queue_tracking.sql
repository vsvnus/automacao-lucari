-- Migration 002: Add queue tracking columns to webhook_events
ALTER TABLE webhook_events ADD COLUMN IF NOT EXISTS queue_job_id VARCHAR(100);
ALTER TABLE webhook_events ADD COLUMN IF NOT EXISTS queued_at TIMESTAMPTZ;
ALTER TABLE webhook_events ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;
