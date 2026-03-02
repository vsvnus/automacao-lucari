-- Migration 005: Schedule configs table for dashboard-managed automations
CREATE TABLE IF NOT EXISTS schedule_configs (
    id SERIAL PRIMARY KEY,
    slug VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    cron_expression VARCHAR(50) NOT NULL,
    timezone VARCHAR(50) DEFAULT 'America/Sao_Paulo',
    enabled BOOLEAN DEFAULT true,
    last_run_at TIMESTAMPTZ,
    last_run_status VARCHAR(20),
    last_run_detail TEXT,
    next_run_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed: monthly tabs scheduler
INSERT INTO schedule_configs (slug, name, description, cron_expression, timezone, enabled)
VALUES (
    'monthly_tabs',
    'Criação de Abas Mensais',
    'Cria abas no Google Sheets para todos os clientes no primeiro dia de cada mês às 07:00 (horário de Brasília). Duplica a aba do mês anterior, limpa leads finalizados e preserva formatação.',
    '0 10 1 * *',
    'America/Sao_Paulo',
    true
)
ON CONFLICT (slug) DO NOTHING;
