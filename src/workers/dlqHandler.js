/**
 * DLQ Handler — Dead Letter Queue management
 *
 * Lists failed jobs, allows retry/removal via API.
 */

const { logger } = require('../utils/logger');

async function getFailedJobs(queue, start = 0, end = 50) {
    try {
        const jobs = await queue.getFailed(start, end);
        return jobs.map(job => ({
            id: job.id,
            name: job.name,
            data: job.data,
            failedReason: job.failedReason,
            attemptsMade: job.attemptsMade,
            timestamp: job.timestamp,
            processedOn: job.processedOn,
            finishedOn: job.finishedOn,
        }));
    } catch (err) {
        logger.error('Error listing failed jobs', { error: err.message });
        return [];
    }
}

async function retryJob(queue, jobId) {
    try {
        const job = await queue.getJob(jobId);
        if (!job) return { success: false, error: 'Job not found' };

        // Smart check: se o lead já foi processado com sucesso, skip o retry
        const phone = job.data?.payload?.phone || job.data?.payload?.phone_e164?.replace('+', '');
        const instanceId = job.data?.payload?.instanceId;
        if (phone && instanceId) {
            try {
                const pgService = require('../pgService');
                const clientManager = require('../clientManager');
                const client = clientManager.findByInstanceId(instanceId);
                if (client && pgService.isAvailable()) {
                    const existing = await pgService.findSuccessLeadByPhone(phone, client.id);
                    if (existing) {
                        await job.remove();
                        logger.info(`DLQ: Job ${jobId} removido — lead já processado`, { phone, client: client.name });
                        return { success: true, skipped: true, reason: 'Lead já processado com sucesso' };
                    }
                }
            } catch (checkErr) {
                // Se a verificação falhar, prossegue com o retry normal
                logger.warn('DLQ: Falha no smart check, prosseguindo com retry', { error: checkErr.message });
            }
        }

        await job.retry();
        logger.info(`DLQ: Job ${jobId} retried`);
        return { success: true };
    } catch (err) {
        logger.error('Error retrying job', { jobId, error: err.message });
        return { success: false, error: err.message };
    }
}

async function retryAll(queue) {
    try {
        const failed = await queue.getFailed(0, 1000);
        let retried = 0;
        for (const job of failed) {
            await job.retry();
            retried++;
        }
        logger.info(`DLQ: Retried ${retried} jobs`);
        return { success: true, retried };
    } catch (err) {
        logger.error('Error retrying all jobs', { error: err.message });
        return { success: false, error: err.message };
    }
}

async function removeJob(queue, jobId) {
    try {
        const job = await queue.getJob(jobId);
        if (!job) return { success: false, error: 'Job not found' };

        await job.remove();
        logger.info(`DLQ: Job ${jobId} removed`);
        return { success: true };
    } catch (err) {
        logger.error('Error removing job', { jobId, error: err.message });
        return { success: false, error: err.message };
    }
}

module.exports = { getFailedJobs, retryJob, retryAll, removeJob };
