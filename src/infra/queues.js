/**
 * Queues — BullMQ queue definitions for async webhook processing
 */

const { Queue } = require('bullmq');
const { getRedis } = require('./redis');

const DEFAULT_JOB_OPTIONS = {
    attempts: 3,
    backoff: {
        type: 'exponential',
        delay: 2000,
    },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 200 },
};

let tintimQueue = null;
let kommoQueue = null;
let compensationQueue = null;
let reconciliationQueue = null;

function getTintimQueue() {
    if (!tintimQueue) {
        tintimQueue = new Queue('webhook-tintim', {
            connection: getRedis(),
            defaultJobOptions: DEFAULT_JOB_OPTIONS,
        });
    }
    return tintimQueue;
}

function getKommoQueue() {
    if (!kommoQueue) {
        kommoQueue = new Queue('webhook-kommo', {
            connection: getRedis(),
            defaultJobOptions: DEFAULT_JOB_OPTIONS,
        });
    }
    return kommoQueue;
}

function getCompensationQueue() {
    if (!compensationQueue) {
        compensationQueue = new Queue('sync-compensation', {
            connection: getRedis(),
            defaultJobOptions: {
                attempts: 5,
                backoff: { type: 'exponential', delay: 5000 },
                removeOnComplete: { count: 200 },
                removeOnFail: { count: 100 },
            },
        });
    }
    return compensationQueue;
}

function getReconciliationQueue() {
    if (!reconciliationQueue) {
        reconciliationQueue = new Queue('reconciliation', {
            connection: getRedis(),
            defaultJobOptions: {
                attempts: 2,
                backoff: { type: 'exponential', delay: 10000 },
                removeOnComplete: { count: 50 },
                removeOnFail: { count: 20 },
            },
        });
    }
    return reconciliationQueue;
}

async function closeQueues() {
    const queues = [tintimQueue, kommoQueue, compensationQueue, reconciliationQueue];
    await Promise.all(queues.filter(Boolean).map(q => q.close()));
    tintimQueue = null;
    kommoQueue = null;
    compensationQueue = null;
    reconciliationQueue = null;
}

module.exports = { getTintimQueue, getKommoQueue, getCompensationQueue, getReconciliationQueue, closeQueues };
