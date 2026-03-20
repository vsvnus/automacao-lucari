/**
 * ReconciliationWorker — Compara leads no Google Sheets vs PostgreSQL
 *
 * Roda a cada 6 horas (repeatable job via BullMQ).
 * Para cada cliente ativo:
 *   1. Lê telefones da aba atual do Sheets
 *   2. Lê telefones com success no PG
 *   3. Detecta discrepâncias:
 *      - Em Sheets mas não em PG → cria registro reconciliado
 *      - Em PG mas não em Sheets → marca needs_review
 *   4. Atualiza tabela sync_status
 */

const { Worker } = require('bullmq');
const { getRedis } = require('../infra/redis');
const { getReconciliationQueue } = require('../infra/queues');
const { logger } = require('../utils/logger');

let reconciliationWorker = null;

const RECONCILE_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 horas
const INTER_CLIENT_DELAY_MS = 2000; // Respeitar rate limit Google Sheets
const MAX_DISCREPANCIES_PER_RUN = 50;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function reconcileClient(client, sheetsService, pgService) {
    const spreadsheetId = client.spreadsheet_id;
    if (!spreadsheetId) {
        return { skipped: true, reason: 'sem spreadsheet_id' };
    }

    // Resolver aba atual
    let sheetName;
    try {
        sheetName = await sheetsService.resolveSheetName(client);
    } catch (err) {
        return { skipped: true, reason: `erro ao resolver aba: ${err.message}` };
    }

    // Ler phones do Sheets
    const sheetPhones = await sheetsService.getSheetLeadPhones(spreadsheetId, sheetName);
    if (!sheetPhones) {
        return { skipped: true, reason: 'erro ao ler Sheets' };
    }

    // Ler phones do PG
    const pgPhones = await pgService.getSuccessLeadPhonesByClient(client.id, sheetName);

    // Normalizar para comparação (últimos 9 dígitos)
    const normalize = (p) => (p || '').replace(/\D/g, '').slice(-9);

    const sheetSet = new Map();
    for (const item of sheetPhones) {
        const key = normalize(item.phone);
        if (key.length >= 8) sheetSet.set(key, item);
    }

    const pgSet = new Set();
    for (const item of pgPhones) {
        pgSet.add(normalize(item.phone));
    }

    // Sheets-only: leads que existem na planilha mas não no PG
    const sheetsOnly = [];
    for (const [key, item] of sheetSet) {
        if (!pgSet.has(key)) {
            sheetsOnly.push(item);
        }
    }

    // PG-only: leads no PG mas não na planilha
    const pgOnly = [];
    for (const phone of pgSet) {
        if (!sheetSet.has(phone)) {
            pgOnly.push(phone);
        }
    }

    // Criar registros reconciliados para Sheets-only (limitado por run)
    let reconciled = 0;
    for (const item of sheetsOnly.slice(0, MAX_DISCREPANCIES_PER_RUN)) {
        try {
            await pgService.logLead(client.id, {
                eventType: 'reconciliation',
                phone: item.phone,
                name: 'Reconciliado (Sheets)',
                status: 'Reconciliado',
                sheetName,
                sheetRow: item.row,
                result: 'reconciled',
                error: null,
            });
            reconciled++;
        } catch (err) {
            logger.warn('[Reconciliation] Falha ao criar registro reconciliado', {
                phone: item.phone,
                error: err.message,
            });
        }
    }

    const discrepancy = sheetsOnly.length + pgOnly.length;
    const status = discrepancy === 0 ? 'ok' : (discrepancy <= 5 ? 'warning' : 'error');

    // Atualizar sync_status
    await pgService.upsertSyncStatus(client.id, {
        sheetsCount: sheetPhones.length,
        pgCount: pgPhones.length,
        discrepancy,
        status,
        details: {
            sheetsOnly: sheetsOnly.length,
            pgOnly: pgOnly.length,
            reconciled,
            sheetName,
        },
    });

    return {
        skipped: false,
        sheetName,
        sheetsCount: sheetPhones.length,
        pgCount: pgPhones.length,
        sheetsOnly: sheetsOnly.length,
        pgOnly: pgOnly.length,
        reconciled,
        status,
    };
}

function startReconciliationWorker() {
    const sheetsService = require('../sheetsService');
    const pgService = require('../pgService');
    const clientManager = require('../clientManager');

    reconciliationWorker = new Worker('reconciliation', async (job) => {
        logger.info('[Reconciliation] Iniciando reconciliação periódica');

        const clients = clientManager.clients.filter(c => c.active);
        const results = {};

        for (const client of clients) {
            try {
                const result = await reconcileClient(client, sheetsService, pgService);
                results[client.slug] = result;

                if (!result.skipped) {
                    logger.info(`[Reconciliation] ${client.name}: Sheets=${result.sheetsCount} PG=${result.pgCount} Discrepância=${result.sheetsOnly + result.pgOnly} Reconciliados=${result.reconciled}`);
                } else {
                    logger.debug(`[Reconciliation] ${client.name}: pulado — ${result.reason}`);
                }
            } catch (err) {
                logger.error(`[Reconciliation] Erro em ${client.name}`, { error: err.message });
                results[client.slug] = { skipped: true, reason: err.message };
            }

            // Rate limiting entre clientes
            await sleep(INTER_CLIENT_DELAY_MS);
        }

        logger.info('[Reconciliation] Reconciliação concluída', {
            clients: Object.keys(results).length,
        });

        return results;
    }, {
        connection: getRedis(),
        concurrency: 1,
    });

    reconciliationWorker.on('completed', (job, result) => {
        logger.info(`[Reconciliation] Job ${job.id} concluído`);
    });

    reconciliationWorker.on('failed', (job, err) => {
        logger.error(`[Reconciliation] Job ${job?.id} falhou`, { error: err.message });
    });

    // Agendar job repetível a cada 6 horas
    getReconciliationQueue().add('reconcile', {}, {
        repeat: { every: RECONCILE_INTERVAL_MS },
    }).catch(err => {
        logger.error('[Reconciliation] Erro ao agendar job repetível', { error: err.message });
    });

    logger.info(`[Reconciliation] Worker iniciado (intervalo: ${RECONCILE_INTERVAL_MS / 3600000}h)`);
    return reconciliationWorker;
}

/**
 * Dispara reconciliação manual imediata.
 */
async function triggerReconciliation() {
    const queue = getReconciliationQueue();
    const job = await queue.add('reconcile-manual', {}, { priority: 1 });
    return { jobId: job.id };
}

async function closeReconciliationWorker() {
    if (reconciliationWorker) {
        await reconciliationWorker.close();
        reconciliationWorker = null;
    }
    logger.info('[Reconciliation] Worker fechado');
}

module.exports = { startReconciliationWorker, closeReconciliationWorker, triggerReconciliation };
