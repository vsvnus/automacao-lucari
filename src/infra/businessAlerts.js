/**
 * Business Alerts — Periodic checks for business-critical conditions
 *
 * Checks every 15 minutes:
 *   1. Zero leads in 6h during business hours (8-20 BRT)
 *   2. Queue depth > 100
 *   3. Error rate > 10% in last hour
 */

const { sendAlert } = require('./alerts');
const { logger } = require('../utils/logger');

let checkInterval = null;

function isBrazilBusinessHours() {
    const now = new Date();
    // Brazil is UTC-3
    const brHour = (now.getUTCHours() - 3 + 24) % 24;
    return brHour >= 8 && brHour < 20;
}

async function checkZeroLeads(pgService) {
    if (!isBrazilBusinessHours()) return;
    if (!pgService.isAvailable()) return;

    try {
        const { rows } = await pgService.query(
            `SELECT COUNT(*) as cnt FROM leads_log WHERE created_at > NOW() - INTERVAL '6 hours' AND processing_result = 'success'`
        );
        const count = parseInt(rows[0].cnt, 10);
        if (count === 0) {
            await sendAlert('Zero Leads', 'Nenhum lead processado nas ultimas 6 horas durante horario comercial.\nVerifique se os webhooks estao funcionando.');
        }
    } catch (err) {
        logger.error('Business alert check failed (zero leads)', { error: err.message });
    }
}

async function checkQueueDepth() {
    try {
        const { isRedisConnected } = require('./redis');
        if (!isRedisConnected()) return;

        const { getTintimQueue, getKommoQueue } = require('./queues');
        const tintimWaiting = await getTintimQueue().getWaitingCount();
        const kommoWaiting = await getKommoQueue().getWaitingCount();
        const total = tintimWaiting + kommoWaiting;

        if (total > 100) {
            await sendAlert('Queue Backlog', `Fila acumulada: ${total} jobs pendentes.\nTintim: ${tintimWaiting} | Kommo: ${kommoWaiting}\nVerifique se os workers estao processando.`);
        }
    } catch (err) {
        logger.error('Business alert check failed (queue depth)', { error: err.message });
    }
}

async function checkErrorRate(pgService) {
    if (!pgService.isAvailable()) return;

    try {
        const { rows } = await pgService.query(
            `SELECT
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE processing_result = 'failed') as failed
             FROM leads_log
             WHERE created_at > NOW() - INTERVAL '1 hour'`
        );
        const total = parseInt(rows[0].total, 10);
        const failed = parseInt(rows[0].failed, 10);

        if (total >= 5 && (failed / total) > 0.1) {
            const rate = Math.round((failed / total) * 100);
            await sendAlert('High Error Rate', `Taxa de erro ${rate}% na ultima hora.\n${failed}/${total} processamentos falharam.\nVerifique os logs para mais detalhes.`);
        }
    } catch (err) {
        logger.error('Business alert check failed (error rate)', { error: err.message });
    }
}

function startBusinessAlerts(pgService) {
    if (checkInterval) return;

    // Run checks every 15 minutes
    checkInterval = setInterval(async () => {
        await checkZeroLeads(pgService);
        await checkQueueDepth();
        await checkErrorRate(pgService);
    }, 15 * 60 * 1000);

    // Also run once on startup (after a short delay)
    setTimeout(async () => {
        await checkZeroLeads(pgService);
        await checkQueueDepth();
        await checkErrorRate(pgService);
    }, 30 * 1000);

    logger.info('Business alerts started (15min interval)');
}

function stopBusinessAlerts() {
    if (checkInterval) {
        clearInterval(checkInterval);
        checkInterval = null;
    }
}

module.exports = { startBusinessAlerts, stopBusinessAlerts };
