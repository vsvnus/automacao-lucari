-- Migration 007: Infraestrutura de sincronização Sheets ↔ PostgreSQL
-- Garante integridade entre dados na planilha e logs no banco

-- Fila de compensação para retries de PG log quando falha após Sheets write
CREATE TABLE IF NOT EXISTS sync_compensation_queue (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id UUID REFERENCES clients(id),
    event_type VARCHAR(50) NOT NULL,
    phone VARCHAR(50),
    lead_name VARCHAR(255),
    sheet_name VARCHAR(100),
    sheet_row INTEGER,
    payload JSONB NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 5,
    last_error TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sync_comp_status ON sync_compensation_queue(status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_sync_comp_created ON sync_compensation_queue(created_at DESC);

-- Status de reconciliação por cliente (última verificação Sheets vs PG)
CREATE TABLE IF NOT EXISTS sync_status (
    id SERIAL PRIMARY KEY,
    client_id UUID REFERENCES clients(id),
    last_reconciliation TIMESTAMPTZ,
    sheets_count INTEGER,
    pg_count INTEGER,
    discrepancy INTEGER DEFAULT 0,
    status VARCHAR(20) DEFAULT 'ok',
    details JSONB,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_status_client ON sync_status(client_id);
