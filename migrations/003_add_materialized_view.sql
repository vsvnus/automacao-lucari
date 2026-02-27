-- Migration 003: Materialized view for dashboard daily stats
-- Aggregates leads/sales/revenue per day/client for fast dashboard loads

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_dashboard_daily_stats AS
SELECT
    DATE(l.created_at AT TIME ZONE 'America/Sao_Paulo') AS day,
    l.client_id,
    c.name AS client_name,
    c.slug AS client_slug,
    COUNT(*) AS total_leads,
    COUNT(*) FILTER (WHERE l.processing_result = 'success') AS successful_leads,
    COUNT(*) FILTER (WHERE l.processing_result = 'filtered') AS filtered_leads,
    COUNT(*) FILTER (WHERE l.processing_result = 'failed') AS failed_leads,
    COUNT(*) FILTER (WHERE l.sale_amount IS NOT NULL OR l.status ILIKE '%comprou%' OR l.status ILIKE '%vend%') AS sales,
    COALESCE(SUM(l.sale_amount) FILTER (WHERE l.sale_amount IS NOT NULL AND l.sale_amount > 0), 0) AS revenue
FROM leads_log l
LEFT JOIN clients c ON l.client_id = c.id
GROUP BY DATE(l.created_at AT TIME ZONE 'America/Sao_Paulo'), l.client_id, c.name, c.slug;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_dashboard_daily ON mv_dashboard_daily_stats (day, client_id);
