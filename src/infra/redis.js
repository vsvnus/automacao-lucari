/**
 * Redis — Singleton ioredis connection for BullMQ and caching
 *
 * Supports REDIS_URL (standard format) or individual env vars:
 *   REDIS_HOST, REDIS_PORT, REDIS_PASSWORD
 */

const Redis = require('ioredis');
const { logger } = require('../utils/logger');

let redis = null;
let isConnected = false;

function buildRedisOptions() {
    const url = process.env.REDIS_URL;

    if (url) {
        // Parse URL manually to avoid Node.js URL parsing issues with special chars
        // Format: redis://:password@host:port
        const match = url.match(/^redis:\/\/:?([^@]*)@([^:]+):(\d+)/);
        if (match) {
            return {
                host: match[2],
                port: parseInt(match[3], 10),
                password: match[1] ? decodeURIComponent(match[1]) : undefined,
            };
        }
        // Try as simple redis://host:port
        const simple = url.match(/^redis:\/\/([^:]+):(\d+)/);
        if (simple) {
            return {
                host: simple[1],
                port: parseInt(simple[2], 10),
            };
        }
    }

    // Fallback to individual env vars or localhost
    return {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
        password: process.env.REDIS_PASSWORD || undefined,
    };
}

function createRedis() {
    if (redis) return redis;

    const opts = buildRedisOptions();

    redis = new Redis({
        ...opts,
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
        logger.info('Redis connected', { host: opts.host, port: opts.port });
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

async function waitForConnection(timeoutMs = 5000) {
    if (isRedisConnected()) return true;
    if (!redis) createRedis();

    return new Promise((resolve) => {
        if (redis.status === 'ready') {
            isConnected = true;
            return resolve(true);
        }

        const timer = setTimeout(() => {
            resolve(false);
        }, timeoutMs);

        redis.once('ready', () => {
            clearTimeout(timer);
            isConnected = true;
            resolve(true);
        });

        redis.once('error', () => {
            clearTimeout(timer);
            resolve(false);
        });
    });
}

async function closeRedis() {
    if (redis) {
        await redis.quit();
        redis = null;
        isConnected = false;
    }
}

module.exports = { getRedis, createRedis, isRedisConnected, waitForConnection, closeRedis };
