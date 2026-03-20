-- Migration 006: Credenciais Kommo por cliente
-- Permite que cada cliente tenha seu proprio subdomain, token e secret do Kommo

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS kommo_subdomain TEXT,
  ADD COLUMN IF NOT EXISTS kommo_access_token TEXT,
  ADD COLUMN IF NOT EXISTS kommo_client_secret TEXT;

CREATE TABLE IF NOT EXISTS kommo_poll_state (
  client_id UUID PRIMARY KEY REFERENCES clients(id),
  last_polled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_lead_id BIGINT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
