/**
 * WebhookWorker — BullMQ worker for async webhook processing
 *
 * Processes webhook-tintim and webhook-kommo queues with:
 *   - Concurrency: 3
 *   - Rate limit: 10 jobs/sec
 *   - 3 retries with exponential backoff
 *   - Cache invalidation after successful processing
 */

const { Worker } = require('bullmq');
const { getRedis } = require('../infra/redis');
const { logger } = require('../utils/logger');

let tintimWorker = null;
let kommoWorker = null;

function startWorkers() {
    const webhookHandler = require('../webhookHandler');
    const kommoHandler = require('../kommoHandler');

    // Tintim webhook worker
    tintimWorker = new Worker('webhook-tintim', async (job) => {
        const { payload } = job.data;
        logger.info(`[Worker] Processing tintim job ${job.id}`, { attemptsMade: job.attemptsMade });

        const result = await webhookHandler.processWebhook(payload);

        // Invalidate caches after processing
        try {
            const cache = require('../infra/cache');
            await cache.invalidatePattern('dashboard:*');
            await cache.invalidatePattern('keywords:*');
        } catch (err) {
            // Cache invalidation is best-effort
        }

        // Update webhook_events with queue tracking info
        try {
            const pgService = require('../pgService');
            if (pgService.isAvailable() && result.traceId) {
                await pgService.query(
                    `UPDATE webhook_events SET queue_job_id = $1, processed_at = NOW() WHERE payload->>'trace_id' = $2 OR (created_at > NOW() - INTERVAL '5 minutes' AND processing_result IS NOT NULL)`,
                    [job.id, result.traceId]
                );
            }
        } catch (err) {
            // Queue tracking update is best-effort
        }

        return result;
    }, {
        connection: getRedis(),
        concurrency: 3,
        limiter: {
            max: 10,
            duration: 1000,
        },
    });

    tintimWorker.on('completed', (job, result) => {
        logger.info(`[Worker] Tintim job ${job.id} completed`, {
            client: result?.client,
            type: result?.type,
            success: result?.success,
        });
    });

    tintimWorker.on('failed', (job, err) => {
        logger.error(`[Worker] Tintim job ${job?.id} failed`, {
            error: err.message,
            attemptsMade: job?.attemptsMade,
            attemptsLeft: (job?.opts?.attempts || 3) - (job?.attemptsMade || 0),
        });

        // Increment metrics if available
        try {
            const metrics = require('../infra/metrics');
            metrics.queueErrors.inc({ queue: 'webhook-tintim' });
        } catch (e) { /* metrics not loaded yet */ }
    });

    // Kommo webhook worker
    kommoWorker = new Worker('webhook-kommo', async (job) => {
        const { body, rawBody, signature } = job.data;
        logger.info(`[Worker] Processing kommo job ${job.id}`, { attemptsMade: job.attemptsMade });

        const result = await kommoHandler.processWebhook(body, rawBody, signature);

        // Invalidate caches after processing
        try {
            const cache = require('../infra/cache');
            await cache.invalidatePattern('dashboard:*');
            await cache.invalidatePattern('keywords:*');
        } catch (err) {
            // Cache invalidation is best-effort
        }

        return result;
    }, {
        connection: getRedis(),
        concurrency: 2,
        limiter: {
            max: 5,
            duration: 1000,
        },
    });

    kommoWorker.on('completed', (job, result) => {
        logger.info(`[Worker] Kommo job ${job.id} completed`, {
            processed: result?.processed,
        });
    });

    kommoWorker.on('failed', (job, err) => {
        logger.error(`[Worker] Kommo job ${job?.id} failed`, {
            error: err.message,
            attemptsMade: job?.attemptsMade,
        });
    });

    logger.info('[Worker] Webhook workers started (tintim + kommo)');
    return { tintimWorker, kommoWorker };
}

async function closeWorkers() {
    const closes = [];
    if (tintimWorker) closes.push(tintimWorker.close());
    if (kommoWorker) closes.push(kommoWorker.close());
    await Promise.all(closes);
    tintimWorker = null;
    kommoWorker = null;
    logger.info('[Worker] All workers closed');
}

function getWorkers() {
    return { tintimWorker, kommoWorker };
}

module.exports = { startWorkers, closeWorkers, getWorkers };
