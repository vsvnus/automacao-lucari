/**
 * CompensationWorker — Processa retries de pgService.logLead() que falharam
 *
 * Quando o Sheets write sucede mas o PG log falha, o webhookHandler enfileira
 * um job nesta fila para garantir que o registro chegue ao PostgreSQL.
 */

const { Worker } = require('bullmq');
const { QUEUE_NAMES } = require('../infra/queues');
const { getRedis } = require('../infra/redis');
const { logger } = require('../utils/logger');

let compensationWorker = null;

function startCompensationWorker() {
    const pgService = require('../pgService');

    compensationWorker = new Worker(QUEUE_NAMES.compensation, async (job) => {
        const { clientId, leadInfo, source } = job.data;
        logger.info(`[Compensation] Processando retry PG log — job ${job.id}`, {
            phone: leadInfo.phone,
            eventType: leadInfo.eventType,
            attemptsMade: job.attemptsMade,
            source,
        });

        if (!pgService.isAvailable()) {
            throw new Error('PostgreSQL indisponível — retry será feito');
        }

        await pgService.logLead(clientId, leadInfo);

        logger.info(`[Compensation] PG log compensado com sucesso — job ${job.id}`, {
            phone: leadInfo.phone,
            eventType: leadInfo.eventType,
        });

        return { success: true, phone: leadInfo.phone, eventType: leadInfo.eventType };
    }, {
        connection: getRedis(),
        concurrency: 2,
        limiter: { max: 5, duration: 1000 },
    });

    compensationWorker.on('completed', (job, result) => {
        logger.info(`[Compensation] Job ${job.id} completado`, { phone: result?.phone });
    });

    compensationWorker.on('failed', (job, err) => {
        logger.error(`[Compensation] Job ${job?.id} falhou`, {
            error: err.message,
            attemptsMade: job?.attemptsMade,
            phone: job?.data?.leadInfo?.phone,
        });

        // Se esgotou tentativas, registrar na tabela de compensação para alerta manual
        if (job && job.attemptsMade >= (job.opts?.attempts || 5)) {
            logFailedCompensation(job.data).catch(e =>
                logger.error('[Compensation] Falha ao registrar compensação falha', { error: e.message })
            );
        }
    });

    logger.info('[Compensation] Worker de compensação iniciado');
    return compensationWorker;
}

async function logFailedCompensation(jobData) {
    const pgService = require('../pgService');
    if (!pgService.isAvailable()) return;

    const { clientId, leadInfo } = jobData;
    await pgService.query(
        `INSERT INTO sync_compensation_queue (client_id, event_type, phone, lead_name, sheet_name, sheet_row, payload, status, attempts, last_error)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'failed', $8, $9)`,
        [
            clientId,
            leadInfo.eventType,
            leadInfo.phone,
            leadInfo.name,
            leadInfo.sheetName,
            leadInfo.sheetRow || null,
            JSON.stringify(leadInfo),
            5,
            'Esgotou tentativas de compensação BullMQ',
        ]
    );
}

async function closeCompensationWorker() {
    if (compensationWorker) {
        await compensationWorker.close();
        compensationWorker = null;
    }
    logger.info('[Compensation] Worker fechado');
}

module.exports = { startCompensationWorker, closeCompensationWorker };
