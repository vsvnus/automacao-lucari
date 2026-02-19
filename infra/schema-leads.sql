-- ============================================================
-- Lucari Digital — Schema: leads_automation
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Sessions (express-session + connect-pg-simple)
CREATE TABLE IF NOT EXISTS "session" (
    "sid" VARCHAR NOT NULL COLLATE "default",
    "sess" JSON NOT NULL,
    "expire" TIMESTAMP(6) NOT NULL,
    CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
);
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");

-- Users (auth)
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Clients
CREATE TABLE IF NOT EXISTS clients (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    slug VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    tintim_instance_id VARCHAR(255),
    tintim_account_code VARCHAR(255) DEFAULT '',
    tintim_account_token VARCHAR(255) DEFAULT '',
    spreadsheet_id VARCHAR(255),
    sheet_name VARCHAR(100) DEFAULT 'auto',
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Leads Log
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

-- Webhook Events
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

-- Indexes
CREATE INDEX IF NOT EXISTS idx_leads_log_created ON leads_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_log_client ON leads_log(client_id);
CREATE INDEX IF NOT EXISTS idx_leads_log_phone ON leads_log(phone);
CREATE INDEX IF NOT EXISTS idx_webhook_events_created ON webhook_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_clients_slug ON clients(slug);

-- Lead Trail (rastreamento passo-a-passo do processamento)
CREATE TABLE IF NOT EXISTS lead_trail (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    trace_id UUID NOT NULL,
    step_order INTEGER NOT NULL,
    step_name VARCHAR(100) NOT NULL,
    status VARCHAR(20) NOT NULL,
    detail TEXT,
    metadata JSONB,
    duration_ms INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lead_trail_trace ON lead_trail(trace_id);
CREATE INDEX IF NOT EXISTS idx_lead_trail_created ON lead_trail(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_trail_status ON lead_trail(status) WHERE status = 'error';
