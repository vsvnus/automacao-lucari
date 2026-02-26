-- Migration 004: Add feature flags column to clients
ALTER TABLE clients ADD COLUMN IF NOT EXISTS feature_flags JSONB DEFAULT '{}';
