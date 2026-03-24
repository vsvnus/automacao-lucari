/**
 * Queues — BullMQ queue definitions for async webhook processing
 *
 * Queue names are prefixed by NODE_ENV so that production and staging
 * workers never compete for the same jobs when sharing a Redis instance.
 */

const { Queue } = require('bullmq');
const { getRedis } = require('./redis');

const ENV_PREFIX = process.env.NODE_ENV === 'production' ? '' : `${process.env.NODE_ENV || 'dev'}-`;

const QUEUE_NAMES = {
    tintim:         `${ENV_PREFIX}webhook-tintim`,
    kommo:          `${ENV_PREFIX}webhook-kommo`,
    compensation:   `${ENV_PREFIX}sync-compensation`,
    reconciliation: `${ENV_PREFIX}reconciliation`,
};

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
        tintimQueue = new Queue(QUEUE_NAMES.tintim, {
            connection: getRedis(),
            defaultJobOptions: DEFAULT_JOB_OPTIONS,
        });
    }
    return tintimQueue;
}

function getKommoQueue() {
    if (!kommoQueue) {
        kommoQueue = new Queue(QUEUE_NAMES.kommo, {
            connection: getRedis(),
            defaultJobOptions: DEFAULT_JOB_OPTIONS,
        });
    }
    return kommoQueue;
}

function getCompensationQueue() {
    if (!compensationQueue) {
        compensationQueue = new Queue(QUEUE_NAMES.compensation, {
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
        reconciliationQueue = new Queue(QUEUE_NAMES.reconciliation, {
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

module.exports = { getTintimQueue, getKommoQueue, getCompensationQueue, getReconciliationQueue, closeQueues, QUEUE_NAMES };
