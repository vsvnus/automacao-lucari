/**
 * ClientConfig — Centralized feature flags per client
 *
 * Reads feature_flags JSONB column from clients table.
 * Defaults are applied if no flags are set (all features enabled).
 */

const { logger } = require('../utils/logger');

const DEFAULT_FLAGS = {
    sheets_enabled: true,
    kommo_enabled: true,
    keyword_tracking: true,
    organic_filter: true,
    trail_tracking: true,
};

function getConfig(client) {
    const flags = client.feature_flags || {};
    return {
        features: { ...DEFAULT_FLAGS, ...flags },
    };
}

async function getFlags(pgService, clientSlug) {
    if (!pgService.isAvailable()) return { ...DEFAULT_FLAGS };

    try {
        const { rows } = await pgService.query(
            'SELECT feature_flags FROM clients WHERE slug = $1',
            [clientSlug]
        );
        if (rows.length === 0) return { ...DEFAULT_FLAGS };
        return { ...DEFAULT_FLAGS, ...(rows[0].feature_flags || {}) };
    } catch (err) {
        logger.error('Error reading feature flags', { slug: clientSlug, error: err.message });
        return { ...DEFAULT_FLAGS };
    }
}

async function setFlags(pgService, clientSlug, flags) {
    if (!pgService.isAvailable()) return null;

    try {
        // Merge with existing flags
        const current = await getFlags(pgService, clientSlug);
        const merged = { ...current, ...flags };

        const { rows } = await pgService.query(
            'UPDATE clients SET feature_flags = $1, updated_at = NOW() WHERE slug = $2 RETURNING slug, feature_flags',
            [JSON.stringify(merged), clientSlug]
        );

        if (rows.length === 0) return null;
        return { ...DEFAULT_FLAGS, ...rows[0].feature_flags };
    } catch (err) {
        logger.error('Error setting feature flags', { slug: clientSlug, error: err.message });
        return null;
    }
}

module.exports = { getConfig, getFlags, setFlags, DEFAULT_FLAGS };
