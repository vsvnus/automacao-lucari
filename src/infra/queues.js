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

async function closeQueues() {
    if (tintimQueue) await tintimQueue.close();
    if (kommoQueue) await kommoQueue.close();
    tintimQueue = null;
    kommoQueue = null;
}

module.exports = { getTintimQueue, getKommoQueue, closeQueues };
