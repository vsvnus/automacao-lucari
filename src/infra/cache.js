/**
 * Cache — Redis-backed caching with fail-open behavior
 *
 * If Redis is down, returns null (no cache) — queries run live.
 * All operations are non-blocking and never throw.
 */

const { getRedis, isRedisConnected } = require('./redis');
const { logger } = require('../utils/logger');

const CACHE_PREFIX = 'cache:';

async function get(key) {
    if (!isRedisConnected()) return null;
    try {
        const data = await getRedis().get(CACHE_PREFIX + key);
        if (!data) return null;
        return JSON.parse(data);
    } catch (err) {
        logger.debug('Cache get error', { key, error: err.message });
        return null;
    }
}

async function set(key, value, ttlSeconds) {
    if (!isRedisConnected()) return false;
    try {
        const serialized = JSON.stringify(value);
        if (ttlSeconds) {
            await getRedis().setex(CACHE_PREFIX + key, ttlSeconds, serialized);
        } else {
            await getRedis().set(CACHE_PREFIX + key, serialized);
        }
        return true;
    } catch (err) {
        logger.debug('Cache set error', { key, error: err.message });
        return false;
    }
}

async function del(key) {
    if (!isRedisConnected()) return false;
    try {
        await getRedis().del(CACHE_PREFIX + key);
        return true;
    } catch (err) {
        logger.debug('Cache del error', { key, error: err.message });
        return false;
    }
}

async function invalidatePattern(pattern) {
    if (!isRedisConnected()) return 0;
    try {
        const redis = getRedis();
        const keys = await redis.keys(CACHE_PREFIX + pattern);
        if (keys.length === 0) return 0;
        const pipeline = redis.pipeline();
        for (const key of keys) {
            pipeline.del(key);
        }
        await pipeline.exec();
        return keys.length;
    } catch (err) {
        logger.debug('Cache invalidatePattern error', { pattern, error: err.message });
        return 0;
    }
}

module.exports = { get, set, del, invalidatePattern };
