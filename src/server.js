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

const app = express();
const PORT = process.env.PORT || 3000;

// ====================================================
// Middlewares
// ====================================================
app.use(express.json());

// Servir Dashboard
app.use(express.static(path.join(__dirname, '..', 'public')));

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
// Webhook do Tintim (POST /webhook/tintim)
// ====================================================
app.post('/webhook/tintim', async (req, res) => {
    // Responder 200 rapidamente para o Tintim não retransmitir
    res.sendStatus(200);

    try {
        const payload = req.body;

        logger.info('Webhook do Tintim recebido', {
            phone: payload.phone,
            instanceId: payload.instanceId,
            chatName: payload.chatName,
        });

        const result = await webhookHandler.processWebhook(payload);

        if (result.success) {
            logger.info(`Lead processado com sucesso → ${result.client}`);
        }
    } catch (error) {
        logger.error('Erro no processamento do webhook Tintim', { error: error.message });
    }
});

// ====================================================
// Painel Administrativo (API)
// ====================================================

// Listar clientes
app.get('/admin/clients', (_req, res) => {
    res.json({ clients: clientManager.getAllClients() });
});

// Adicionar cliente
app.post('/admin/clients', (req, res) => {
    try {
        const newClient = clientManager.addClient(req.body);
        res.status(201).json(newClient);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Deletar cliente
app.delete('/admin/clients/:id', (req, res) => {
    try {
        clientManager.deleteClient(req.params.id);
        res.sendStatus(204);
    } catch (error) {
        res.status(404).json({ error: error.message });
    }
});

// Recarregar configurações
app.post('/admin/reload', (_req, res) => {
    clientManager.reloadClients();
    sheetsService.clearCache();
    res.json({ success: true });
});

app.get('/admin/stats', (_req, res) => {
    res.json(clientManager.getStats());
});

// ====================================================
// Inicialização
// ====================================================
async function startServer() {
    try {
        clientManager.loadClients();
        await sheetsService.initialize();

        app.listen(PORT, () => {
            logger.info(`🚀 Servidor rodando em http://localhost:${PORT}`);
            logger.info(`📡 Webhook Tintim: http://localhost:${PORT}/webhook/tintim`);
            logger.info(`📊 Dashboard: http://localhost:${PORT}`);
        });

        // Auto-reload config every 5 min
        setInterval(() => clientManager.reloadClients(), 5 * 60 * 1000);
    } catch (error) {
        logger.error('Erro ao iniciar servidor', { error: error.message });
        process.exit(1);
    }
}

startServer();
