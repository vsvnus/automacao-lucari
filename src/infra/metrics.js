/**
 * Metrics — Prometheus metrics for observability
 *
 * Exposes metrics at GET /metrics in Prometheus text format.
 * All metrics are prefixed with lucari_.
 */

const client = require('prom-client');

// Collect default Node.js metrics (heap, CPU, event loop, etc.)
const register = new client.Registry();
client.collectDefaultMetrics({ register, prefix: 'lucari_' });

// HTTP request duration histogram
const httpRequestDuration = new client.Histogram({
    name: 'lucari_http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [register],
});

// Webhook processing duration histogram
const webhookProcessingDuration = new client.Histogram({
    name: 'lucari_webhook_processing_duration_seconds',
    help: 'Webhook processing duration in seconds',
    labelNames: ['queue', 'result'],
    buckets: [0.1, 0.5, 1, 2.5, 5, 10, 30],
    registers: [register],
});

// Queue processed counter
const queueProcessed = new client.Counter({
    name: 'lucari_queue_processed_total',
    help: 'Total jobs processed by queue',
    labelNames: ['queue', 'result'],
    registers: [register],
});

// Queue errors counter
const queueErrors = new client.Counter({
    name: 'lucari_queue_errors_total',
    help: 'Total queue processing errors',
    labelNames: ['queue'],
    registers: [register],
});

// Leads processed counter
const leadsProcessed = new client.Counter({
    name: 'lucari_leads_processed_total',
    help: 'Total leads processed',
    labelNames: ['client', 'origin', 'result'],
    registers: [register],
});

// PG pool connections gauge
const pgPoolActive = new client.Gauge({
    name: 'lucari_pg_pool_active_connections',
    help: 'Active PostgreSQL pool connections',
    registers: [register],
});

const pgPoolTotal = new client.Gauge({
    name: 'lucari_pg_pool_total_connections',
    help: 'Total PostgreSQL pool connections',
    registers: [register],
});

const pgPoolWaiting = new client.Gauge({
    name: 'lucari_pg_pool_waiting_connections',
    help: 'Waiting PostgreSQL pool connections',
    registers: [register],
});

// Queue depth gauges
const queueWaiting = new client.Gauge({
    name: 'lucari_queue_waiting',
    help: 'Jobs waiting in queue',
    labelNames: ['queue'],
    registers: [register],
});

const queueActive = new client.Gauge({
    name: 'lucari_queue_active',
    help: 'Jobs actively being processed',
    labelNames: ['queue'],
    registers: [register],
});

const queueFailed = new client.Gauge({
    name: 'lucari_queue_failed',
    help: 'Failed jobs in queue',
    labelNames: ['queue'],
    registers: [register],
});

// Normalize route for metric labels (avoid high cardinality)
function normalizeRoute(path) {
    if (!path) return 'unknown';
    // Replace UUIDs and IDs with :id
    return path
        .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:id')
        .replace(/\/\d+/g, '/:id')
        .replace(/\?.*$/, '');
}

module.exports = {
    register,
    httpRequestDuration,
    webhookProcessingDuration,
    queueProcessed,
    queueErrors,
    leadsProcessed,
    pgPoolActive,
    pgPoolTotal,
    pgPoolWaiting,
    queueWaiting,
    queueActive,
    queueFailed,
    normalizeRoute,
};
