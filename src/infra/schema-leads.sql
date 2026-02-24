-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users (Auth)
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Clients (Tenants)
CREATE TABLE IF NOT EXISTS clients (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    slug VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    tintim_instance_id VARCHAR(255),
    tintim_account_code VARCHAR(255),
    tintim_account_token VARCHAR(255),
    spreadsheet_id VARCHAR(255),
    sheet_name VARCHAR(100) DEFAULT 'auto',
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Leads Log (History/Audit)
CREATE TABLE IF NOT EXISTS leads_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id UUID REFERENCES clients(id),
    event_type VARCHAR(50),
    phone VARCHAR(50),
    lead_name VARCHAR(255),
    status VARCHAR(255),
    product VARCHAR(255),
    sale_amount DECIMAL(12,2),
    origin VARCHAR(100),
    sheet_name VARCHAR(100),
    sheet_row INTEGER,
    processing_result VARCHAR(50),
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Webhook Log (Raw Events)
CREATE TABLE IF NOT EXISTS webhook_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id UUID REFERENCES clients(id),
    event_type VARCHAR(100),
    instance_id VARCHAR(255),
    phone VARCHAR(50),
    payload JSONB,
    processing_result VARCHAR(50),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- System Settings
CREATE TABLE IF NOT EXISTS system_settings (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Session Store (connect-pg-simple)
CREATE TABLE IF NOT EXISTS session (
  sid varchar NOT NULL COLLATE "default",
  sess json NOT NULL,
  expire timestamp(6) NOT NULL
)
WITH (OIDS=FALSE);

ALTER TABLE session ADD CONSTRAINT session_pkey PRIMARY KEY (sid) NOT DEFERRABLE INITIALLY IMMEDIATE;
CREATE INDEX IF NOT EXISTS idx_session_expire ON session(expire);

-- Migration: Add role and updated_at to users
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'role') THEN
        ALTER TABLE users ADD COLUMN role VARCHAR(20) DEFAULT 'admin';
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'updated_at') THEN
        ALTER TABLE users ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
    END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_leads_log_created ON leads_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_log_client ON leads_log(client_id);
CREATE INDEX IF NOT EXISTS idx_leads_log_phone ON leads_log(phone);
CREATE INDEX IF NOT EXISTS idx_webhook_events_created ON webhook_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_clients_slug ON clients(slug);
