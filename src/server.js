/**
 * Server — Automação de Leads via Tintim → Google Sheets
 *
 * Endpoints:
 *   GET  /              → Dashboard Admin
 *   GET  /health        → Health check (expanded with pool + queue stats)
 *   GET  /metrics       → Prometheus metrics
 *   POST /webhook/tintim → Recebimento de leads do Tintim (async via BullMQ)
 *   POST /webhook/kommo  → Recebimento de leads do Kommo CRM
 *
 *   Auth:
 *   POST /api/auth/login  → Login
 *   POST /api/auth/logout → Logout
 *   GET  /api/auth/me     → Usuário atual
 *
 *   CRUD Clientes:
 *   GET    /admin/clients      → Listar todos
 *   POST   /admin/clients      → Criar novo
 *   PUT    /admin/clients/:id  → Atualizar
 *   DELETE /admin/clients/:id  → Remover
 *   POST   /admin/reload       → Forçar recarga
 *
 *   Admin:
 *   /admin/queues              → Bull Board UI
 *   /api/admin/dlq/:queue      → Dead Letter Queue management
 *   /api/admin/features/:slug  → Feature flags per client
 */

require('dotenv').config();

const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const bcrypt = require('bcryptjs');
const path = require('path');
const { logger } = require('./utils/logger');
const webhookHandler = require('./webhookHandler');
const kommoHandler = require('./kommoHandler');
const clientManager = require('./clientManager');
const sheetsService = require('./sheetsService');
const pgService = require('./pgService');

// Phase 1: Queue infrastructure
const { isRedisConnected, waitForConnection } = require('./infra/redis');
const { getTintimQueue, getKommoQueue, closeQueues } = require('./infra/queues');
const { startWorkers, closeWorkers } = require('./workers/webhookWorker');
const { setupBullBoard } = require('./infra/bullBoard');

// Phase 2: Cache
const cache = require('./infra/cache');

// Phase 3: Observability
const metrics = require('./infra/metrics');
const { startBusinessAlerts, stopBusinessAlerts } = require('./infra/businessAlerts');

// Phase 4: Config & DLQ
const clientConfig = require('./infra/clientConfig');
const dlqHandler = require('./workers/dlqHandler');

// Inicializar PostgreSQL ANTES de tudo
pgService.initialize();

const app = express();
const PORT = process.env.PORT || 3000;
let httpServer = null;

// Trust reverse proxy (Coolify/Traefik) for correct session handling behind HTTPS
app.set('trust proxy', 1);

// ====================================================
// Middlewares
// ====================================================

// Phase 3: HTTP request timing middleware
app.use((req, res, next) => {
    const end = metrics.httpRequestDuration.startTimer();
    res.on('finish', () => {
        const route = metrics.normalizeRoute(req.route?.path || req.path);
        end({ method: req.method, route, status_code: res.statusCode });
    });
    next();
});

// Skip JSON body parsing for SDR knowledge upload (multipart/form-data)
app.use((req, res, next) => {
    if (req.path.match(/^\/api\/sdr\/tenants\/[^/]+\/knowledge$/) && req.method === 'POST') {
        return next();
    }
    // Skip JSON for Kommo webhook (uses x-www-form-urlencoded)
    if (req.path === '/webhook/kommo' && req.method === 'POST') {
        return next();
    }
    express.json({ limit: '1mb' })(req, res, next);
});

// Security Headers
app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.removeHeader('X-Powered-By');
    if (process.env.NODE_ENV === 'production') {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
});

// Session (express-session + connect-pg-simple)
const sessionConfig = {
    store: new PgSession({
        pool: pgService.pool, // Garantimos que o pool existe pois chamamos initialize() antes
        tableName: 'session',
        createTableIfMissing: true,
    }),
    secret: process.env.SESSION_SECRET || 'lucari-dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false, // HTTP Only (sem SSL ainda)
        httpOnly: true,
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 dias
        sameSite: 'lax',
    },
    name: 'lucari.sid',
};

app.use(session(sessionConfig));

// Servir Dashboard (arquivos estáticos)
app.use(express.static(path.join(__dirname, '..', 'public')));

// Phase 1: Rate limiting with Redis persistence (fallback to in-memory Map)
async function checkRateLimit(key, maxRequests, windowSeconds) {
    if (isRedisConnected()) {
        try {
            const redis = require('./infra/redis').getRedis();
            const redisKey = `ratelimit:${key}`;
            const count = await redis.incr(redisKey);
            if (count === 1) {
                await redis.expire(redisKey, windowSeconds);
            }
            return count > maxRequests;
        } catch (err) {
            // Fall through to in-memory
        }
    }

    // Fallback: in-memory Map
    const now = Date.now();
    const windowMs = windowSeconds * 1000;
    if (!webhookRateLimit.has(key)) {
        webhookRateLimit.set(key, { count: 1, start: now });
        return false;
    }
    const entry = webhookRateLimit.get(key);
    if (now - entry.start > windowMs) {
        webhookRateLimit.set(key, { count: 1, start: now });
        return false;
    }
    entry.count++;
    return entry.count > maxRequests;
}

const webhookRateLimit = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minuto
const MAX_REQUESTS = 60; // 60 requests/minuto

setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of webhookRateLimit.entries()) {
        if (now - entry.start > RATE_LIMIT_WINDOW) {
            webhookRateLimit.delete(ip);
        }
    }
}, 5 * 60 * 1000);

// Rate limiter para login (brute force protection)
const loginRateLimit = new Map();
const LOGIN_WINDOW = 15 * 60 * 1000; // 15 minutos
const LOGIN_MAX_PER_IP = 10;
const LOGIN_MAX_PER_EMAIL = 10;

setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of loginRateLimit) {
        if (now - entry.start > LOGIN_WINDOW) loginRateLimit.delete(key);
    }
}, LOGIN_WINDOW);

app.use((req, _res, next) => {
    logger.debug(`${req.method} ${req.path}`);
    next();
});

// ====================================================
// Auth Middleware
// ====================================================

function requireAuth(req, res, next) {
    if (req.session && req.session.userId) {
        return next();
    }
    res.status(401).json({ error: 'Não autenticado' });
}

// ====================================================
// Rotas Públicas
// ====================================================

// Phase 3: Prometheus metrics endpoint
app.get('/metrics', async (_req, res) => {
    try {
        res.set('Content-Type', metrics.register.contentType);
        res.end(await metrics.register.metrics());
    } catch (err) {
        res.status(500).end(err.message);
    }
});

// Phase 4: Expanded health check with pool + queue stats
app.get('/health', async (_req, res) => {
    const stats = clientManager.getStats();
    const sheetsOk = sheetsService.sheets !== null;

    // Check Evolution API via SDR health
    let evolutionOk = false;
    try {
        const http = require('http');
        let sdrUrl = process.env.SDR_API_URL || 'http://localhost:3001';
        if (sdrUrl === 'http://lucari-sdr:3001') sdrUrl = 'https://sdr.vin8n.online';

        const sdrHealth = await new Promise((resolve) => {
            const reqUrl = sdrUrl + '/health';
            const client = reqUrl.startsWith('https') ? require('https') : require('http');
            const req = client.get(reqUrl, { timeout: 3000 }, (resp) => {
                let data = '';
                resp.on('data', (chunk) => data += chunk);
                resp.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
            });
            req.on('error', () => resolve(null));
            req.on('timeout', () => { req.destroy(); resolve(null); });
        });
        evolutionOk = sdrHealth && sdrHealth.evolution === true;
    } catch (e) { }

    // Pool stats
    let poolStats = null;
    if (pgService.isAvailable() && pgService.pool) {
        poolStats = {
            total: pgService.pool.totalCount,
            idle: pgService.pool.idleCount,
            waiting: pgService.pool.waitingCount,
        };
    }

    // Queue stats
    let queueStats = null;
    if (isRedisConnected()) {
        try {
            const tq = getTintimQueue();
            const kq = getKommoQueue();
            const [tw, ta, tf, kw, ka, kf] = await Promise.all([
                tq.getWaitingCount(), tq.getActiveCount(), tq.getFailedCount(),
                kq.getWaitingCount(), kq.getActiveCount(), kq.getFailedCount(),
            ]);
            queueStats = {
                tintim: { waiting: tw, active: ta, failed: tf },
                kommo: { waiting: kw, active: ka, failed: kf },
            };
        } catch (e) { }
    }

    res.json({
        status: sheetsOk ? 'ok' : 'degraded',
        commit: process.env.SOURCE_COMMIT || 'unknown',
        uptime: process.uptime(),
        clients: stats.totalActiveClients,
        integrations: {
            googleSheets: sheetsOk ? 'connected' : 'disconnected',
            postgresql: pgService.isAvailable() ? 'connected' : 'disconnected',
            redis: isRedisConnected() ? 'connected' : 'disconnected',
            evolution: evolutionOk ? 'connected' : 'disconnected',
        },
        pool: poolStats,
        queues: queueStats,
    });
});

// Phase 1: Webhook Principal — async via BullMQ with synchronous fallback
app.post('/webhook/tintim', async (req, res) => {
    // Auth: validate shared secret
    const webhookSecret = process.env.WEBHOOK_SECRET;
    if (webhookSecret && req.query.token !== webhookSecret) {
        logger.warn('Webhook rejected: invalid token', { ip: req.ip });
        return res.status(401).json({ error: 'Unauthorized' });
    }

    // Rate limiting
    const rateLimited = await checkRateLimit(`webhook:${req.ip}`, MAX_REQUESTS, 60);
    if (rateLimited) {
        logger.warn(`Rate limit excedido para IP ${req.ip}`);
        return res.status(429).json({ error: 'Too many requests' });
    }

    // Try async queue first, fallback to synchronous processing
    if (isRedisConnected()) {
        try {
            const job = await getTintimQueue().add('tintim-webhook', {
                payload: req.body,
                receivedAt: new Date().toISOString(),
                ip: req.ip,
            });
            return res.json({ status: 'queued', jobId: job.id });
        } catch (err) {
            logger.warn('Failed to queue webhook, falling back to sync', { error: err.message });
        }
    }

    // Synchronous fallback (Redis offline or queue error)
    try {
        await webhookHandler.processWebhook(req.body);
        res.json({ status: 'received' });
    } catch (error) {
        logger.error('Erro no webhook', { error: error.message });
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Kommo CRM Webhook (x-www-form-urlencoded with raw body for signature verification)
// Phase 1: Also queued via BullMQ with sync fallback
app.post('/webhook/kommo', express.urlencoded({
    extended: true,
    verify: function(req, _res, buf) { req.rawBody = buf.toString('utf8'); },
}), async (req, res) => {
    // Rate limiting
    const rateLimited = await checkRateLimit(`webhook:${req.ip}`, MAX_REQUESTS, 60);
    if (rateLimited) {
        logger.warn('Rate limit excedido para Kommo webhook IP ' + req.ip);
        return res.status(429).json({ error: 'Too many requests' });
    }

    // Responder IMEDIATAMENTE (Kommo exige resposta em 2 segundos)
    res.status(200).json({ success: true });

    const signature = req.headers['x-signature'] || '';

    // Try async queue first
    if (isRedisConnected()) {
        try {
            await getKommoQueue().add('kommo-webhook', {
                body: req.body,
                rawBody: req.rawBody,
                signature,
                receivedAt: new Date().toISOString(),
            });
            return; // Queued successfully, response already sent
        } catch (err) {
            logger.warn('Failed to queue Kommo webhook, falling back to sync', { error: err.message });
        }
    }

    // Synchronous fallback
    try {
        await kommoHandler.processWebhook(req.body, req.rawBody, signature);
    } catch (error) {
        logger.error('Erro no webhook Kommo', { error: error.message });
    }
});

// ====================================================
// Auto-migrate plaintext passwords to bcrypt on startup
// ====================================================
async function migratePasswordsToHash() {
    if (!pgService.isAvailable()) return;
    try {
        const { rows } = await pgService.query('SELECT id, password_hash FROM users');
        for (const user of rows) {
            if (user.password_hash && !user.password_hash.startsWith('$2')) {
                const hashed = await bcrypt.hash(user.password_hash, 10);
                await pgService.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [hashed, user.id]);
                logger.info(`Password migrated to bcrypt for user ${user.id}`);
            }
        }
    } catch (error) {
        logger.error('Erro na migração de senhas', { error: error.message });
    }
}

// Setup check (public)
app.get('/api/auth/setup-needed', async (_req, res) => {
    const count = await pgService.countUsers();
    res.json({ setupNeeded: count === 0 });
});

// Setup — create first admin (only works with 0 users)
app.post('/api/auth/setup', async (req, res) => {
    const { email, password, name } = req.body;

    if (!email || !password || !name) {
        return res.status(400).json({ error: 'Nome, email e senha são obrigatórios' });
    }
    if (password.length < 6) {
        return res.status(400).json({ error: 'Senha deve ter no mínimo 6 caracteres' });
    }

    const count = await pgService.countUsers();
    if (count > 0) {
        return res.status(403).json({ error: 'Setup já foi realizado. Use o login.' });
    }

    try {
        const passwordHash = await bcrypt.hash(password, 10);
        const user = await pgService.createUser(email, passwordHash, name, 'admin');
        logger.info(`Setup: primeiro admin criado — ${email}`);
        res.status(201).json({ user: { id: user.id, email: user.email, name: user.name } });
    } catch (error) {
        if (error.code === '23505') {
            return res.status(409).json({ error: 'Email já cadastrado' });
        }
        res.status(500).json({ error: 'Erro ao criar conta' });
    }
});

// Login
app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    const ip = req.ip;
    const now = Date.now();

    // Rate limit por IP
    const ipKey = `ip:${ip}`;
    const ipEntry = loginRateLimit.get(ipKey) || { count: 0, start: now };
    if (now - ipEntry.start > LOGIN_WINDOW) { ipEntry.count = 0; ipEntry.start = now; }
    ipEntry.count++;
    loginRateLimit.set(ipKey, ipEntry);
    if (ipEntry.count > LOGIN_MAX_PER_IP) {
        logger.warn(`Login rate limit (IP): ${ip}`);
        return res.status(429).json({ error: 'Muitas tentativas. Aguarde 15 minutos.' });
    }

    // Rate limit por email
    if (email) {
        const emailKey = `email:${email.toLowerCase()}`;
        const emailEntry = loginRateLimit.get(emailKey) || { count: 0, start: now };
        if (now - emailEntry.start > LOGIN_WINDOW) { emailEntry.count = 0; emailEntry.start = now; }
        emailEntry.count++;
        loginRateLimit.set(emailKey, emailEntry);
        if (emailEntry.count > LOGIN_MAX_PER_EMAIL) {
            logger.warn(`Login rate limit (email): ${email}`);
            return res.status(429).json({ error: 'Muitas tentativas. Aguarde 15 minutos.' });
        }
    }

    const user = await pgService.findUserByEmail(email);

    if (user) {
        const storedHash = user.password_hash;
        if (storedHash && storedHash.startsWith('$2')) {
            const valid = await bcrypt.compare(password, storedHash);
            if (valid) {
                req.session.userId = user.id;
                req.session.user = { id: user.id, email: user.email, name: user.name };

                logger.info(`Login bem-sucedido: ${email}`);

                return req.session.save((err) => {
                    if (err) {
                        logger.error('Erro ao salvar sessão', err);
                        return res.status(500).json({ error: 'Erro de sessão' });
                    }
                    res.json({ user: req.session.user });
                });
            }
        }
    }

    logger.warn(`Tentativa de login falhou: ${email}`);
    res.status(401).json({ error: 'Credenciais inválidas' });
});

app.post('/api/auth/logout', (req, res) => {
    req.session.destroy();
    res.json({ status: 'ok' });
});

app.get('/api/auth/me', (req, res) => {
    if (req.session && req.session.user) {
        res.json({ user: req.session.user });
    } else {
        res.status(401).json({ error: 'Não autenticado' });
    }
});

// ====================================================
// Rotas Privadas (Admin)
// ====================================================
// Todas as rotas abaixo requerem autenticação

// 1. Clientes
app.get('/admin/clients', requireAuth, async (_req, res) => {
    const clients = await clientManager.getAllClients(); // Usa pgService internamente
    res.json(clients);
});

app.post('/admin/clients', requireAuth, async (req, res) => {
    try {
        const newClient = await clientManager.addClient(req.body);
        // Phase 2: Invalidate client cache
        await cache.invalidatePattern('clients:*');
        res.status(201).json(newClient);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.put('/admin/clients/:id', requireAuth, async (req, res) => {
    try {
        const updated = await clientManager.updateClient(req.params.id, req.body);
        if (!updated) return res.status(404).json({ error: 'Cliente não encontrado' });
        // Phase 2: Invalidate client cache
        await cache.invalidatePattern('clients:*');
        res.json(updated);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.delete('/admin/clients/:id', requireAuth, async (req, res) => {
    try {
        const success = await clientManager.deleteClient(req.params.id);
        if (!success) return res.status(404).json({ error: 'Cliente não encontrado' });
        // Phase 2: Invalidate client cache
        await cache.invalidatePattern('clients:*');
        res.json({ status: 'deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/admin/reload', requireAuth, async (_req, res) => {
    await clientManager.reloadClients();
    await cache.invalidatePattern('clients:*');
    res.json({ status: 'reloaded' });
});

app.get('/admin/status', requireAuth, (_req, res) => {
    const stats = clientManager.getStats();
    res.json({
        status: 'ok',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        clients: stats.totalActiveClients,
        dataSource: stats.dataSource,
    });
});

// ====================================================
// Dashboard & Investigação API (protegido por auth)
// Phase 2: All dashboard endpoints cached via Redis
// ====================================================

app.get('/api/dashboard/stats', requireAuth, async (req, res) => {
    const { from, to } = req.query;
    const cacheKey = `dashboard:stats:${from || ''}:${to || ''}`;
    const cached = await cache.get(cacheKey);
    if (cached) return res.json(cached);

    const stats = await pgService.getDashboardStats(from, to);
    if (!stats) return res.status(500).json({ error: 'Erro ao carregar estatísticas' });

    await cache.set(cacheKey, stats, 60);
    res.json(stats);
});

app.get('/api/dashboard/activity', requireAuth, async (req, res) => {
    const { limit, from, to } = req.query;
    const activity = await pgService.getDashboardActivity(limit || 20, from, to);
    res.json(activity);
});

app.get('/api/dashboard/investigate', requireAuth, async (req, res) => {
    const { q, limit, source, from, to } = req.query;
    const results = await pgService.searchAllEvents(q, { source, from, to, limit: limit || 50 });
    res.json(results);
});

app.get('/api/dashboard/clients-preview', requireAuth, async (req, res) => {
    const { from, to } = req.query;
    // Retorna lista de clientes com contagem de leads no período
    const counts = await pgService.getLeadsCountByClient(from, to);

    // Pegar nomes dos clientes (ativos)
    const clients = clientManager.clients;

    const result = clients.map(c => ({
        slug: c.slug,
        name: c.name,
        leadsCount: counts[c.slug] || 0
    })).sort((a, b) => b.leadsCount - a.leadsCount);

    res.json(result);
});

// Overview Stats (enhanced dashboard data)
app.get('/api/dashboard/overview', requireAuth, async (req, res) => {
    const { from, to } = req.query;
    const cacheKey = `dashboard:overview:${from || ''}:${to || ''}`;
    const cached = await cache.get(cacheKey);
    if (cached) return res.json(cached);

    const overview = await pgService.getOverviewStats({ from, to });
    if (!overview) return res.status(500).json({ error: 'Erro ao carregar overview' });

    await cache.set(cacheKey, overview, 120);
    res.json(overview);
});

// Errors Summary (for Erros tab)
app.get('/api/dashboard/errors-summary', requireAuth, async (_req, res) => {
    const summary = await pgService.getErrorsSummary();
    if (!summary) return res.status(500).json({ error: 'Erro ao carregar resumo de erros' });
    res.json(summary);
});

app.get('/api/dashboard/client/:slug/logs', requireAuth, async (req, res) => {
    const logs = await pgService.getLeadsByClient(req.params.slug, 50);
    res.json(logs);
});

// Logs Genéricos
app.get('/admin/logs', requireAuth, async (req, res) => {
    const { limit, search } = req.query;
    const logs = await pgService.getProcessedLeads(search, limit || 50);
    res.json(logs);
});

// Configurações do Sistema
app.get('/admin/settings/webhook-url', requireAuth, async (req, res) => {
    const url = await pgService.getSetting('webhook_url');
    // Se não tiver no DB, usa o domínio real (via proxy/Traefik) ou fallback
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
    const host = req.headers['x-forwarded-host'] || req.hostname;
    const fallback = `${proto}://${host}/webhook/tintim`;
    res.json({ webhook_url: url || fallback });
});

app.post('/admin/settings/webhook-url', requireAuth, async (req, res) => {
    const { webhook_url } = req.body;
    if (!webhook_url) {
        return res.status(400).json({ error: 'webhook_url é obrigatório' });
    }
    const saved = await pgService.setSetting('webhook_url', webhook_url);
    if (saved) {
        logger.info(`Webhook URL atualizada: ${webhook_url}`);
        res.json({ success: true, webhook_url });
    } else {
        res.status(500).json({ error: 'Erro ao salvar. PostgreSQL indisponível?' });
    }
});

// ====================================================
// User Management API (protected)
// ====================================================

app.get('/api/users', requireAuth, async (_req, res) => {
    const users = await pgService.listUsers();
    res.json(users);
});

app.post('/api/users', requireAuth, async (req, res) => {
    const { email, password, name, role } = req.body;

    if (!email || !password || !name) {
        return res.status(400).json({ error: 'Nome, email e senha são obrigatórios' });
    }
    if (password.length < 6) {
        return res.status(400).json({ error: 'Senha deve ter no mínimo 6 caracteres' });
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return res.status(400).json({ error: 'Email inválido' });
    }

    try {
        const passwordHash = await bcrypt.hash(password, 10);
        const user = await pgService.createUser(email, passwordHash, name, role || 'admin');
        logger.info(`Usuário criado: ${email}`);
        res.status(201).json(user);
    } catch (error) {
        if (error.code === '23505') {
            return res.status(409).json({ error: 'Email já cadastrado' });
        }
        res.status(500).json({ error: 'Erro ao criar usuário' });
    }
});

app.put('/api/users/:id', requireAuth, async (req, res) => {
    const { id } = req.params;
    const { email, password, name, role } = req.body;

    // Cannot remove admin role from yourself
    if (id === req.session.userId && role && role !== 'admin') {
        return res.status(400).json({ error: 'Você não pode remover seu próprio papel de admin' });
    }

    if (email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ error: 'Email inválido' });
        }
    }
    if (password !== undefined && password !== '' && password.length < 6) {
        return res.status(400).json({ error: 'Senha deve ter no mínimo 6 caracteres' });
    }

    try {
        let passwordHash = null;
        if (password && password.length >= 6) {
            passwordHash = await bcrypt.hash(password, 10);
        }

        const updated = await pgService.updateUser(id, { email, name, role, passwordHash });
        if (!updated) {
            return res.status(404).json({ error: 'Usuário não encontrado' });
        }
        logger.info(`Usuário atualizado: ${id}`);
        res.json(updated);
    } catch (error) {
        if (error.code === '23505') {
            return res.status(409).json({ error: 'Email já cadastrado por outro usuário' });
        }
        res.status(500).json({ error: 'Erro ao atualizar usuário' });
    }
});

app.delete('/api/users/:id', requireAuth, async (req, res) => {
    const { id } = req.params;

    // Cannot delete yourself
    if (id === req.session.userId) {
        return res.status(400).json({ error: 'Você não pode deletar sua própria conta' });
    }

    // Must keep at least 1 user
    const count = await pgService.countUsers();
    if (count <= 1) {
        return res.status(400).json({ error: 'O sistema precisa de pelo menos 1 usuário' });
    }

    try {
        const deleted = await pgService.deleteUser(id);
        if (!deleted) {
            return res.status(404).json({ error: 'Usuário não encontrado' });
        }

        // Invalidate sessions for deleted user
        try {
            await pgService.query(
                `DELETE FROM session WHERE sess::jsonb->>'userId' = $1`,
                [id]
            );
        } catch { /* session cleanup is best-effort */ }

        logger.info(`Usuário deletado: ${id}`);
        res.json({ status: 'deleted' });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao deletar usuário' });
    }
});

// ====================================================
// Alertas de Clientes Sem Leads
// ====================================================

app.get("/api/alerts/clients-without-leads", requireAuth, async (req, res) => {
    const daysThreshold = parseInt(req.query.days || "2", 10);
    const alerts = await pgService.getClientsWithoutLeads(daysThreshold);
    res.json(alerts);
});

app.get("/api/alerts/client/:id/webhook-errors", requireAuth, async (req, res) => {
    const clientId = req.params.id;
    const limit = parseInt(req.query.limit || "20", 10);
    const errors = await pgService.getClientWebhookErrors(clientId, limit);
    res.json(errors);
});

app.get("/api/alerts/webhook/:id", requireAuth, async (req, res) => {
    const webhookId = req.params.id;
    const webhook = await pgService.getWebhookById(webhookId);
    if (!webhook) return res.status(404).json({ error: "Webhook não encontrado" });
    res.json(webhook);
});

app.post("/api/alerts/webhook/:id/resend", requireAuth, async (req, res) => {
    const webhookId = req.params.id;
    const webhook = await pgService.getWebhookById(webhookId);

    if (!webhook) {
        return res.status(404).json({ error: "Webhook não encontrado" });
    }

    try {
        const webhookHandler = require("./webhookHandler");
        const result = await webhookHandler.processWebhook(webhook.payload);
        res.json({ success: true, result });
        logger.info(`Webhook reenviado com sucesso: ${webhookId}`);
    } catch (error) {
        logger.error("Erro ao reenviar webhook", { webhookId, error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});
// ====================================================

// ====================================================
// Keywords API (Palavras-Chave Google Ads)
// Phase 2: Cached responses
// ====================================================

app.get('/api/keywords/stats', requireAuth, async (req, res) => {
    const { client, from, to } = req.query;
    const cacheKey = `keywords:stats:${client || ''}:${from || ''}:${to || ''}`;
    const cached = await cache.get(cacheKey);
    if (cached) return res.json(cached);

    const stats = await pgService.getKeywordsStats(client || null, from || null, to || null);
    await cache.set(cacheKey, stats, 120);
    res.json(stats);
});

app.get('/api/keywords/overview', requireAuth, async (req, res) => {
    const { client, from, to } = req.query;
    const data = await pgService.getKeywordsOverview(client || null, from || null, to || null);
    res.json(data);
});

app.get('/api/keywords/trend', requireAuth, async (req, res) => {
    const { client, from, to } = req.query;
    const data = await pgService.getKeywordsTrend(client || null, from || null, to || null);
    res.json(data);
});

app.get('/api/keywords/detail', requireAuth, async (req, res) => {
    const { keyword, client, from, to } = req.query;
    if (!keyword) return res.status(400).json({ error: 'keyword is required' });
    const data = await pgService.getKeywordDetail(keyword, client || null, from || null, to || null);
    res.json(data);
});

app.get('/api/keywords/breakdown', requireAuth, async (req, res) => {
    const { client, from, to } = req.query;
    const data = await pgService.getKeywordsBreakdown(client || null, from || null, to || null);
    res.json(data);
});

app.get('/api/keywords/campaigns', requireAuth, async (req, res) => {
    const { client, from, to } = req.query;
    const data = await pgService.getCampaignsOverview(client || null, from || null, to || null);
    res.json(data);
});

app.post('/api/keywords/backfill', requireAuth, async (_req, res) => {
    try {
        const count = await pgService.backfillKeywords();
        res.json({ success: true, migrated: count });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ====================================================
// Trail & Alerts API (novo sistema de rastreamento)
// ====================================================

app.get("/api/alerts/errors", requireAuth, async (req, res) => {
    const limit = parseInt(req.query.limit || "50", 10);
    const [errors, stats] = await Promise.all([
        pgService.getTrailErrors(limit),
        pgService.getTrailErrorStats(),
    ]);
    res.json({ errors, stats });
});

app.get("/api/alerts/trail/:traceId", requireAuth, async (req, res) => {
    const trail = await pgService.getTrailByTrace(req.params.traceId);
    if (!trail || trail.length === 0) {
        return res.status(404).json({ error: "Trail não encontrado" });
    }
    res.json(trail);
});

app.post("/api/alerts/retry/:traceId", requireAuth, async (req, res) => {
    const traceId = req.params.traceId;
    const payload = await pgService.getPayloadByTraceId(traceId);
    if (!payload) {
        return res.status(404).json({ error: "Payload original não encontrado para este trace" });
    }

    try {
        const result = await webhookHandler.processWebhook(payload);
        logger.info(`Webhook reenviado via trail: ${traceId}`, { newTraceId: result.traceId });
        res.json({ success: true, result });
    } catch (error) {
        logger.error("Erro ao reenviar webhook via trail", { traceId, error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get("/api/alerts/error-count", requireAuth, async (_req, res) => {
    const stats = await pgService.getTrailErrorStats();
    res.json(stats);
});

// ====================================================
// Phase 4: DLQ Management API
// ====================================================

app.get('/api/admin/dlq/:queue', requireAuth, async (req, res) => {
    const queueName = req.params.queue;
    let queue;
    if (queueName === 'webhook-tintim') queue = getTintimQueue();
    else if (queueName === 'webhook-kommo') queue = getKommoQueue();
    else return res.status(400).json({ error: 'Queue not found. Use: webhook-tintim or webhook-kommo' });

    const jobs = await dlqHandler.getFailedJobs(queue);
    res.json(jobs);
});

app.post('/api/admin/dlq/:queue/retry/:jobId', requireAuth, async (req, res) => {
    const queueName = req.params.queue;
    let queue;
    if (queueName === 'webhook-tintim') queue = getTintimQueue();
    else if (queueName === 'webhook-kommo') queue = getKommoQueue();
    else return res.status(400).json({ error: 'Queue not found' });

    const result = await dlqHandler.retryJob(queue, req.params.jobId);
    res.json(result);
});

app.post('/api/admin/dlq/:queue/retry-all', requireAuth, async (req, res) => {
    const queueName = req.params.queue;
    let queue;
    if (queueName === 'webhook-tintim') queue = getTintimQueue();
    else if (queueName === 'webhook-kommo') queue = getKommoQueue();
    else return res.status(400).json({ error: 'Queue not found' });

    const result = await dlqHandler.retryAll(queue);
    res.json(result);
});

app.delete('/api/admin/dlq/:queue/:jobId', requireAuth, async (req, res) => {
    const queueName = req.params.queue;
    let queue;
    if (queueName === 'webhook-tintim') queue = getTintimQueue();
    else if (queueName === 'webhook-kommo') queue = getKommoQueue();
    else return res.status(400).json({ error: 'Queue not found' });

    const result = await dlqHandler.removeJob(queue, req.params.jobId);
    res.json(result);
});

// ====================================================
// Phase 4: Feature Flags API
// ====================================================

app.get('/api/admin/features/:slug', requireAuth, async (req, res) => {
    const flags = await clientConfig.getFlags(pgService, req.params.slug);
    res.json(flags);
});

app.put('/api/admin/features/:slug', requireAuth, async (req, res) => {
    const result = await clientConfig.setFlags(pgService, req.params.slug, req.body);
    if (!result) return res.status(404).json({ error: 'Client not found' });
    await cache.invalidatePattern('clients:*');
    res.json(result);
});


async function startServer() {
    try {
        // 1.5. Rodar migrations se necessário
        if (pgService.isAvailable()) {
            await pgService.runMigrations();
            await migratePasswordsToHash();
        }

        // 2. Carregar clientes (PostgreSQL → fallback JSON)
        await clientManager.loadClients();

        // 3. Inicializar Google Sheets (opcional no dev / staging pode não ter credenciais)
        try {
            await sheetsService.initialize();
        } catch (err) {
            logger.warn(`Google Sheets não disponível/inicializado: ${err.message}`);
        }

        // Phase 1: Wait for Redis connection, then start BullMQ workers
        const redisReady = await waitForConnection(5000);
        if (redisReady) {
            startWorkers();
            logger.info('BullMQ workers started');
        } else {
            logger.warn('Redis not connected — running in synchronous mode (no queues)');
        }

        httpServer = app.listen(PORT, () => {
            const stats = clientManager.getStats();
            logger.info(`Servidor rodando em http://localhost:${PORT}`);
            logger.info(`Webhook Tintim: http://localhost:${PORT}/webhook/tintim`);
            logger.info(`Webhook Kommo: http://localhost:${PORT}/webhook/kommo`);
            logger.info(`Dashboard: http://localhost:${PORT}`);
            logger.info(`Fonte de dados: ${stats.dataSource}`);
            logger.info(`Redis: ${isRedisConnected() ? 'connected (async mode)' : 'disconnected (sync mode)'}`);
        });

        // Phase 1: Setup Bull Board UI
        if (isRedisConnected()) {
            setupBullBoard(app, requireAuth);
            logger.info('Bull Board mounted at /admin/queues');
        }

        // Phase 2: Materialized view refresh every 15 minutes
        if (pgService.isAvailable()) {
            setInterval(async () => {
                try {
                    await pgService.query('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_dashboard_daily_stats');
                    logger.debug('Materialized view refreshed');
                } catch (err) {
                    // View may not exist yet (first deploy)
                    if (!err.message.includes('does not exist')) {
                        logger.error('Failed to refresh materialized view', { error: err.message });
                    }
                }
            }, 15 * 60 * 1000);
        }

        // Phase 3: Pool monitoring — update Prometheus gauges every 15s
        if (pgService.isAvailable() && pgService.pool) {
            setInterval(() => {
                metrics.pgPoolActive.set(pgService.pool.totalCount - pgService.pool.idleCount);
                metrics.pgPoolTotal.set(pgService.pool.totalCount);
                metrics.pgPoolWaiting.set(pgService.pool.waitingCount);
            }, 15 * 1000);
        }

        // Phase 3: Queue depth monitoring every 30s
        if (isRedisConnected()) {
            setInterval(async () => {
                try {
                    const tq = getTintimQueue();
                    const kq = getKommoQueue();
                    const [tw, ta, tf, kw, ka, kf] = await Promise.all([
                        tq.getWaitingCount(), tq.getActiveCount(), tq.getFailedCount(),
                        kq.getWaitingCount(), kq.getActiveCount(), kq.getFailedCount(),
                    ]);
                    metrics.queueWaiting.set({ queue: 'webhook-tintim' }, tw);
                    metrics.queueActive.set({ queue: 'webhook-tintim' }, ta);
                    metrics.queueFailed.set({ queue: 'webhook-tintim' }, tf);
                    metrics.queueWaiting.set({ queue: 'webhook-kommo' }, kw);
                    metrics.queueActive.set({ queue: 'webhook-kommo' }, ka);
                    metrics.queueFailed.set({ queue: 'webhook-kommo' }, kf);
                } catch (err) {
                    // Queue monitoring is best-effort
                }
            }, 30 * 1000);
        }

        // Phase 3: Start business alerts
        startBusinessAlerts(pgService);

        // ====================================================
        // Cross-Service Proxy (SDR + Calculadora)
        // ====================================================

        let SDR_URL = process.env.SDR_API_URL || (process.env.NODE_ENV === 'production' ? 'https://sdr.vin8n.online' : 'http://localhost:3001');
        if (SDR_URL === 'http://lucari-sdr:3001') SDR_URL = 'https://sdr.vin8n.online';

        const CALC_URL = process.env.CALC_API_URL || 'http://localhost:3002';
        const RELATORIO_URL = process.env.RELATORIO_API_URL || 'http://relatorio-dev:3003';
        const RELATORIO_API_KEY = process.env.RELATORIO_API_KEY || 'admin123';

        // Generic proxy helper
        const proxyRequest = async (targetBase, subPath, req, res, { raw = false, extraHeaders = {} } = {}) => {
            try {
                const http = require('http');
                const https = require('https');
                const url = new URL(subPath, targetBase);

                // Forward query params
                if (req.query) {
                    for (const [k, v] of Object.entries(req.query)) {
                        url.searchParams.set(k, v);
                    }
                }

                const proto = url.protocol === 'https:' ? https : http;
                const headers = {};
                if (raw) {
                    // Forward original headers for multipart/form-data
                    if (req.headers['content-type']) headers['content-type'] = req.headers['content-type'];
                    if (req.headers['content-length']) headers['content-length'] = req.headers['content-length'];
                } else {
                    headers['Content-Type'] = 'application/json';
                }
                const internalKey = process.env.INTERNAL_API_KEY || 'lucari-internal-dev-2026';
                if (internalKey) {
                    headers['X-Internal-Key'] = internalKey;
                }

                const options = {
                    hostname: url.hostname,
                    port: url.port,
                    path: url.pathname + url.search,
                    method: req.method,
                    headers: {
                        ...headers,
                        ...extraHeaders,
                    },
                    timeout: 30000,
                };

                const proxyReq = proto.request(options, (proxyRes) => {
                    res.status(proxyRes.statusCode);
                    proxyRes.pipe(res);
                });

                proxyReq.on('error', (err) => {
                    logger.debug(`Proxy error (${targetBase}): ${err.message}`);
                    if (!res.headersSent) {
                        res.status(502).json({ error: 'Serviço indisponível' });
                    }
                });

                if (raw) {
                    // Pipe raw request body (multipart/form-data)
                    req.pipe(proxyReq);
                } else {
                    if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.body) {
                        proxyReq.write(JSON.stringify(req.body));
                    }
                    proxyReq.end();
                }
            } catch (err) {
                res.status(502).json({ error: 'Serviço indisponível' });
            }
        };

        // SDR Knowledge Upload — raw proxy BEFORE express.json() would interfere
        // This route must pipe raw multipart body directly to the SDR backend
        app.post('/api/sdr/tenants/:id/knowledge', requireAuth, (req, res) => {
            const subPath = `/api/tenants/${req.params.id}/knowledge`;
            proxyRequest(SDR_URL, subPath, req, res, { raw: true });
        });

        // SDR Proxy (general)
        app.all('/api/sdr/*', requireAuth, (req, res) => {
            const subPath = req.path.replace('/api/sdr', '/api');
            proxyRequest(SDR_URL, subPath, req, res);
        });

        // Calculadora Proxy
        app.all('/api/calc/*', requireAuth, (req, res) => {
            const subPath = req.path.replace('/api/calc', '/api');
            proxyRequest(CALC_URL, subPath, req, res);
        });

        // Relatório Proxy
        app.all('/api/relatorio/*', requireAuth, (req, res) => {
            const subPath = req.path.replace('/api/relatorio', '/api');
            proxyRequest(RELATORIO_URL, subPath, req, res, { extraHeaders: { 'x-auth': RELATORIO_API_KEY } });
        });

        // SPA Fallback
        app.get('*', (req, res) => {
            if (req.path.startsWith('/api') || req.path.startsWith('/admin') || req.path.includes('.')) {
                return res.status(404).send('Not found');
            }
            res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
        });

        // Auto-reload config every 5 min
        setInterval(() => clientManager.reloadClients(), 5 * 60 * 1000);
    } catch (error) {
        logger.error('Erro ao iniciar servidor', { error: error.message });
        process.exit(1);
    }
}

// ====================================================
// Phase 4: Graceful shutdown
// ====================================================

async function gracefulShutdown(signal) {
    logger.info(`Received ${signal}. Starting graceful shutdown...`);

    const SHUTDOWN_TIMEOUT = 30000;
    const shutdownTimer = setTimeout(() => {
        logger.error('Graceful shutdown timed out, forcing exit');
        process.exit(1);
    }, SHUTDOWN_TIMEOUT);

    try {
        // 1. Stop accepting new connections
        if (httpServer) {
            await new Promise((resolve) => httpServer.close(resolve));
            logger.info('HTTP server closed');
        }

        // 2. Stop business alerts
        stopBusinessAlerts();

        // 3. Close BullMQ workers (drain current jobs)
        await closeWorkers();

        // 4. Close queues
        await closeQueues();

        // 5. Close Redis
        const { closeRedis } = require('./infra/redis');
        await closeRedis();
        logger.info('Redis closed');

        // 6. Close PG pool
        if (pgService.isAvailable() && pgService.pool) {
            await pgService.pool.end();
            logger.info('PostgreSQL pool closed');
        }

        clearTimeout(shutdownTimer);
        logger.info('Graceful shutdown complete');
        process.exit(0);
    } catch (err) {
        logger.error('Error during graceful shutdown', { error: err.message });
        clearTimeout(shutdownTimer);
        process.exit(1);
    }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

startServer();
