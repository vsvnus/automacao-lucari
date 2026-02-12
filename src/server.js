/**
 * Server — Automação de Leads via Tintim → Google Sheets
 * 
 * Endpoints:
 *   GET  /              → Dashboard Admin
 *   GET  /health        → Health check
 *   POST /webhook/tintim → Recebimento de leads do Tintim
 *   
 *   CRUD Clientes:
 *   GET    /admin/clients      → Listar todos
 *   POST   /admin/clients      → Criar novo
 *   DELETE /admin/clients/:id  → Remover
 *   POST   /admin/reload       → Forçar recarga
 */

require('dotenv').config();

const express = require('express');
const path = require('path');
const { logger } = require('./utils/logger');
const webhookHandler = require('./webhookHandler');
const clientManager = require('./clientManager');
const sheetsService = require('./sheetsService');
const supabaseService = require('./supabaseService');

const app = express();
const PORT = process.env.PORT || 3000;

// ====================================================
// Middlewares
// ====================================================

// Limitar tamanho do payload JSON (previne payload bombs)
app.use(express.json({ limit: '1mb' }));

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

// Servir Dashboard
app.use(express.static(path.join(__dirname, '..', 'public')));

// Rate limiter simples para webhook (previne flood)
const webhookRateLimit = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minuto
const RATE_LIMIT_MAX = 60; // máx 60 requests por minuto

function checkWebhookRateLimit(ip) {
    const now = Date.now();
    const entry = webhookRateLimit.get(ip);
    if (!entry || now - entry.start > RATE_LIMIT_WINDOW) {
        webhookRateLimit.set(ip, { start: now, count: 1 });
        return true;
    }
    entry.count++;
    return entry.count <= RATE_LIMIT_MAX;
}

// Limpar rate limit a cada 5 min
setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of webhookRateLimit) {
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
// Health Check
// ====================================================
app.get('/health', (_req, res) => {
    const stats = clientManager.getStats();
    res.json({
        status: 'ok',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        clients: stats.totalActiveClients,
    });
});

// ====================================================
// Dashboard & Investigação API
// ====================================================

app.get('/api/dashboard/stats', async (_req, res) => {
    const stats = await supabaseService.getDashboardStats();
    res.json(stats || { received: 0, processed: 0, errors: 0 });
});

app.get('/api/dashboard/activity', async (_req, res) => {
    const activity = await supabaseService.getDashboardActivity(20);
    res.json(activity);
});

app.get('/api/dashboard/search', async (req, res) => {
    const { q, source } = req.query;
    if (source === 'all') {
        // Modo debug: busca em webhook_events + leads_log (raw)
        const results = await supabaseService.searchAllEvents(q || '');
        res.json(results);
    } else {
        // Default: busca apenas em leads_log (limpo, sem duplicatas)
        const results = await supabaseService.getProcessedLeads(q || '');
        res.json(results);
    }
});

app.get('/api/dashboard/lead/:phone', async (req, res) => {
    const timeline = await supabaseService.getLeadTimeline(req.params.phone);
    res.json(timeline);
});

app.get('/api/dashboard/errors', async (_req, res) => {
    const errors = await supabaseService.getRecentErrors();
    res.json(errors);
});


// ====================================================
// Webhook do Tintim (POST /webhook/tintim)
// ====================================================
app.post('/webhook/tintim', async (req, res) => {
    // Rate limiting
    const clientIp = req.ip || req.connection.remoteAddress;
    if (!checkWebhookRateLimit(clientIp)) {
        logger.warn('Rate limit excedido no webhook', { ip: clientIp });
        return res.status(429).json({ error: 'Too many requests' });
    }

    // Responder 200 rapidamente para o Tintim não retransmitir
    res.sendStatus(200);

    try {
        const payload = req.body;

        logger.info('Webhook do Tintim recebido', {
            phone: payload.phone || payload.phone_e164,
            instanceId: payload.instanceId || payload.account?.code,
            chatName: payload.chatName || payload.name,
            eventType: payload.event_type,
        });

        // Processar (webhookHandler cuida de todo o logging em webhook_events e leads_log)
        const result = await webhookHandler.processWebhook(payload);
        if (result.success) {
            logger.info(`Lead processado com sucesso → ${result.client}`);
        }
    } catch (error) {
        logger.error('Erro CRÍTICO no processamento do webhook Tintim', { error: error.message });
        // Tentar registrar o erro fatal no Supabase se possível
        try {
            await supabaseService.logWebhookEvent(req.body, null, `critical_error: ${error.message}`);
        } catch (e) {
            console.error('Falha dupla: não foi possível logar erro crítico', e);
        }
    }
});

// ====================================================
// Painel Administrativo (API)
// ====================================================

// Listar clientes
app.get('/admin/clients', async (_req, res) => {
    const clients = await clientManager.getAllClients();
    res.json({ clients });
});

// Adicionar cliente
app.post('/admin/clients', async (req, res) => {
    try {
        const newClient = await clientManager.addClient(req.body);
        res.status(201).json(newClient);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Atualizar cliente
app.put('/admin/clients/:id', async (req, res) => {
    try {
        const updated = await supabaseService.updateClient(req.params.id, req.body);
        // Atualizar cache local se necessário
        await clientManager.reloadClients();
        res.json(updated);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Deletar cliente
app.delete('/admin/clients/:id', async (req, res) => {
    try {
        await clientManager.deleteClient(req.params.id);
        res.sendStatus(204);
    } catch (error) {
        res.status(404).json({ error: error.message });
    }
});

// Recarregar configurações
app.post('/admin/reload', async (_req, res) => {
    await clientManager.reloadClients();
    sheetsService.clearCache();
    res.json({ success: true, dataSource: clientManager.getStats().dataSource });
});

app.get('/admin/stats', async (_req, res) => {
    const stats = clientManager.getStats();

    // Buscar contagem total de leads (se disponível no Supabase)
    const totalLeads = await supabaseService.getTotalLeads(); // Vou criar esse método a seguir
    stats.totalLeads = totalLeads;

    res.json(stats);
});

// Atividade Recente (Leads)
app.get('/admin/activity', async (_req, res) => {
    const logs = await supabaseService.getRecentLeads(20);
    res.json({ logs });
});

// Logs por Cliente
app.get('/admin/clients/:id/logs', async (req, res) => {
    const result = await supabaseService.getLeadsByClient(req.params.id, 50);
    res.json(result);
});

// Webhook URL — get
app.get('/admin/settings/webhook-url', async (req, res) => {
    const url = await supabaseService.getSetting('webhook_url');
    const fallback = `${req.protocol}://${req.get('host')}/webhook/tintim`;
    res.json({ webhook_url: url || fallback });
});

// Webhook URL — save
app.post('/admin/settings/webhook-url', async (req, res) => {
    const { webhook_url } = req.body;
    if (!webhook_url) {
        return res.status(400).json({ error: 'webhook_url é obrigatório' });
    }
    const saved = await supabaseService.setSetting('webhook_url', webhook_url);
    if (saved) {
        logger.info(`Webhook URL atualizada: ${webhook_url}`);
        res.json({ success: true, webhook_url });
    } else {
        res.status(500).json({ error: 'Erro ao salvar. Supabase indisponível?' });
    }
});

// ====================================================
// Config public for Frontend
// ====================================================
app.get('/api/config', (_req, res) => {
    res.json({
        supabaseUrl: process.env.SUPABASE_URL,
        supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
    });
});

// ====================================================
// Inicialização
// ====================================================
async function startServer() {
    try {
        // 1. Inicializar Supabase (se configurado)
        supabaseService.initialize();

        // 2. Carregar clientes (Supabase → fallback JSON)  
        await clientManager.loadClients();

        // 3. Inicializar Google Sheets
        await sheetsService.initialize();

        app.listen(PORT, () => {
            const stats = clientManager.getStats();
            logger.info(`🚀 Servidor rodando em http://localhost:${PORT}`);
            logger.info(`📡 Webhook Tintim: http://localhost:${PORT}/webhook/tintim`);
            logger.info(`📊 Dashboard: http://localhost:${PORT}`);
            logger.info(`💾 Fonte de dados: ${stats.dataSource}`);
        });

        // ============================================
        // SPA Fallback (frontend routing)
        // ============================================
        app.get('*', (req, res) => {
            // Ignorar chamadas API ou arquivos estáticos que não existem
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
