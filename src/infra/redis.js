/**
 * Redis — Singleton ioredis connection for BullMQ and caching
 */

const Redis = require('ioredis');
const { logger } = require('../utils/logger');

let redis = null;
let isConnected = false;

function getRedisUrl() {
    return process.env.REDIS_URL || 'redis://localhost:6379';
}

function createRedis() {
    if (redis) return redis;

    const url = getRedisUrl();

    redis = new Redis(url, {
        maxRetriesPerRequest: null, // Required by BullMQ
        enableReadyCheck: true,
        retryStrategy(times) {
            if (times > 10) return null; // Stop retrying after 10 attempts
            return Math.min(times * 500, 5000);
        },
        lazyConnect: false,
    });

    redis.on('connect', () => {
        isConnected = true;
        logger.info('Redis connected');
    });

    redis.on('error', (err) => {
        isConnected = false;
        logger.error('Redis error', { error: err.message });
    });

    redis.on('close', () => {
        isConnected = false;
        logger.warn('Redis connection closed');
    });

    return redis;
}

function getRedis() {
    if (!redis) return createRedis();
    return redis;
}

function isRedisConnected() {
    return isConnected && redis && redis.status === 'ready';
}

async function closeRedis() {
    if (redis) {
        await redis.quit();
        redis = null;
        isConnected = false;
    }
}

module.exports = { getRedis, createRedis, isRedisConnected, closeRedis };
