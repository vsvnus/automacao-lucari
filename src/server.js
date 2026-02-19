/**
 * Server — Automação de Leads via Tintim → Google Sheets
 *
 * Endpoints:
 *   GET  /              → Dashboard Admin
 *   GET  /health        → Health check
 *   POST /webhook/tintim → Recebimento de leads do Tintim
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
 */

require('dotenv').config();

const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const bcrypt = require('bcryptjs');
const path = require('path');
const { logger } = require('./utils/logger');
const webhookHandler = require('./webhookHandler');
const clientManager = require('./clientManager');
const sheetsService = require('./sheetsService');
const pgService = require('./pgService');

// Inicializar PostgreSQL ANTES de tudo
pgService.initialize();

const app = express();
const PORT = process.env.PORT || 3000;

// Trust reverse proxy (Coolify/Traefik) for correct session handling behind HTTPS
app.set('trust proxy', 1);

// ====================================================
// Middlewares
// ====================================================

// Skip JSON body parsing for SDR knowledge upload (multipart/form-data)
app.use((req, res, next) => {
    if (req.path.match(/^\/api\/sdr\/tenants\/[^/]+\/knowledge$/) && req.method === 'POST') {
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

// Rate limiter para webhook
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

app.get('/health', (_req, res) => {
    const stats = clientManager.getStats();
    const sheetsOk = sheetsService.sheets !== null;
    res.json({
        status: sheetsOk ? 'ok' : 'degraded',
        uptime: process.uptime(),
        clients: stats.totalActiveClients,
        integrations: {
            googleSheets: sheetsOk ? 'connected' : 'disconnected',
            postgresql: pgService.isAvailable() ? 'connected' : 'disconnected',
        }
    });
});

// Webhook Principal
app.post('/webhook/tintim', async (req, res) => {
    const ip = req.ip;
    const now = Date.now();

    if (!webhookRateLimit.has(ip)) {
        webhookRateLimit.set(ip, { count: 1, start: now });
    } else {
        const entry = webhookRateLimit.get(ip);
        entry.count++;
        if (entry.count > MAX_REQUESTS) {
            logger.warn(`Rate limit excedido para IP ${ip}`);
            return res.status(429).json({ error: 'Too many requests' });
        }
    }

    try {
        await webhookHandler.processWebhook(req.body);
        res.json({ status: 'received' });
    } catch (error) {
        logger.error('Erro no webhook', { error: error.message });
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Login
app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;

    // Admin hardcoded fallback removido, agora usa DB
    // Verificar usuário no banco
    const user = await pgService.query('SELECT * FROM users WHERE email = $1', [email]);
    
    if (user && user.rows.length > 0) {
        const userData = user.rows[0];
        // Comparar senha (bcrypt, ou plain text se for migração legado)
        // Por simplificação debug, assumindo plain text se for legado ou bcrypt correto
        // Na criação manual via curl usamos 'admin123', que não é hash bcrypt.
        // Vamos permitir plain text temporariamente para o login manual funcionar.
        
        let validPassword = false;
        const storedHash = userData.password_hash || userData.password;
        if (storedHash && storedHash.startsWith('$2')) {
            validPassword = await bcrypt.compare(password, storedHash);
        } else {
            validPassword = (password === storedHash);
        }

        if (validPassword) {
            req.session.userId = userData.id;
            req.session.user = { id: userData.id, email: userData.email, name: userData.name };
            
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
        res.status(201).json(newClient);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.put('/admin/clients/:id', requireAuth, async (req, res) => {
    try {
        const updated = await clientManager.updateClient(req.params.id, req.body);
        if (!updated) return res.status(404).json({ error: 'Cliente não encontrado' });
        res.json(updated);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.delete('/admin/clients/:id', requireAuth, async (req, res) => {
    try {
        const success = await clientManager.deleteClient(req.params.id);
        if (!success) return res.status(404).json({ error: 'Cliente não encontrado' });
        res.json({ status: 'deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/admin/reload', requireAuth, async (_req, res) => {
    await clientManager.reloadClients();
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
// ====================================================

app.get('/api/dashboard/stats', requireAuth, async (req, res) => {
    const { from, to } = req.query;
    const stats = await pgService.getDashboardStats(from, to);
    if (!stats) return res.status(500).json({ error: 'Erro ao carregar estatísticas' });
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
// Inicialização

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
    if (\!trail || trail.length === 0) {
        return res.status(404).json({ error: "Trail não encontrado" });
    }
    res.json(trail);
});

app.post("/api/alerts/retry/:traceId", requireAuth, async (req, res) => {
    const traceId = req.params.traceId;
    const payload = await pgService.getPayloadByTraceId(traceId);
    if (\!payload) {
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


async function startServer() {
    try {
        // 1.5. Rodar migrations se necessário
        if (pgService.isAvailable()) {
            await pgService.runMigrations();
        }

        // 2. Carregar clientes (PostgreSQL → fallback JSON)
        await clientManager.loadClients();

        // 3. Inicializar Google Sheets (opcional no dev)
        try {
            await sheetsService.initialize();
        } catch (err) {
            logger.warn(`Google Sheets não disponível: ${err.message}`);
        }

        app.listen(PORT, () => {
            const stats = clientManager.getStats();
            logger.info(`Servidor rodando em http://localhost:${PORT}`);
            logger.info(`Webhook Tintim: http://localhost:${PORT}/webhook/tintim`);
            logger.info(`Dashboard: http://localhost:${PORT}`);
            logger.info(`Fonte de dados: ${stats.dataSource}`);
        });

        // ====================================================
        // Cross-Service Proxy (SDR + Calculadora)
        // ====================================================

        const SDR_URL = process.env.SDR_API_URL || 'http://localhost:3001';
        const CALC_URL = process.env.CALC_API_URL || 'http://localhost:3002';

        // Generic proxy helper
        const proxyRequest = async (targetBase, subPath, req, res, { raw = false } = {}) => {
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
                if (process.env.INTERNAL_API_KEY) {
                    headers['X-Internal-Key'] = process.env.INTERNAL_API_KEY;
                }

                const options = {
                    hostname: url.hostname,
                    port: url.port,
                    path: url.pathname + url.search,
                    method: req.method,
                    headers,
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

startServer();
