-- Migration 008: Monitor de Vendas por Campanha/Anúncio
-- Estende keyword_conversions para aceitar também Meta Ads (hoje só Google).
-- Todas as mudanças são ADITIVAS e IDEMPOTENTES — sem risco a dados existentes.

-- channel: 'google' | 'meta' | 'paid' | null (null = dados antigos, assumir google)
ALTER TABLE keyword_conversions ADD COLUMN IF NOT EXISTS channel VARCHAR(20);

-- Dados vindos de payload.ad.* (Meta) ou extraídos do nome da campanha (Google)
ALTER TABLE keyword_conversions ADD COLUMN IF NOT EXISTS ad_name VARCHAR(500);
ALTER TABLE keyword_conversions ADD COLUMN IF NOT EXISTS ad_id VARCHAR(100);
ALTER TABLE keyword_conversions ADD COLUMN IF NOT EXISTS campaign_id VARCHAR(100);

-- Meta-específico: Click-to-WhatsApp ad ID
ALTER TABLE keyword_conversions ADD COLUMN IF NOT EXISTS ctwa_clid VARCHAR(500);

-- converted_at já é usado em upsertKeywordConversion() mas nunca foi adicionado ao schema
ALTER TABLE keyword_conversions ADD COLUMN IF NOT EXISTS converted_at TIMESTAMPTZ;

-- Backfill channel para linhas pré-existentes (Google only antes desta migration)
UPDATE keyword_conversions
   SET channel = 'google'
 WHERE channel IS NULL;

-- Índices novos
CREATE INDEX IF NOT EXISTS idx_kc_channel ON keyword_conversions(channel);
CREATE INDEX IF NOT EXISTS idx_kc_client_channel ON keyword_conversions(client_id, channel);
CREATE INDEX IF NOT EXISTS idx_kc_ad_id ON keyword_conversions(ad_id) WHERE ad_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_kc_campaign_id ON keyword_conversions(campaign_id) WHERE campaign_id IS NOT NULL;
