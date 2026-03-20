/**
 * KommoWebhookRegistration — Registro de webhooks na API Kommo
 *
 * Registra webhooks para eventos: add_lead, status_lead, update_lead,
 * add_contact, update_contact. Garante que leads novos disparem webhook
 * na criacao (nao apenas na mudanca de status).
 */

const { logger } = require('./utils/logger');
const kommoHandler = require('./kommoHandler');

/**
 * Registra webhooks na conta Kommo do cliente.
 * POST /api/v4/webhooks
 */
async function registerWebhooks(client, callbackUrl) {
    var creds = kommoHandler.getClientKommoCredentials(client);
    if (!creds.subdomain || !creds.token) {
        return { success: false, error: 'Credenciais Kommo nao configuradas para ' + client.name };
    }

    var url = 'https://' + creds.subdomain + '.kommo.com/api/v4/webhooks';

    var payload = {
        destination: callbackUrl,
        settings: [
            'add_lead',
            'status_lead',
            'update_lead',
            'add_contact',
            'update_contact',
        ],
    };

    try {
        var res = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + creds.token,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });

        var body = await res.json().catch(function() { return null; });

        if (!res.ok) {
            logger.error('[Kommo Webhooks] Falha ao registrar para ' + client.name + ': HTTP ' + res.status, { body: body });
            return { success: false, error: 'HTTP ' + res.status, details: body };
        }

        logger.info('[Kommo Webhooks] Webhooks registrados para ' + client.name + ' -> ' + callbackUrl);
        return { success: true, data: body };
    } catch (err) {
        logger.error('[Kommo Webhooks] Erro ao registrar para ' + client.name + ': ' + err.message);
        return { success: false, error: err.message };
    }
}

/**
 * Lista webhooks registrados na conta Kommo do cliente.
 * GET /api/v4/webhooks
 */
async function listWebhooks(client) {
    var creds = kommoHandler.getClientKommoCredentials(client);
    if (!creds.subdomain || !creds.token) {
        return { success: false, error: 'Credenciais Kommo nao configuradas para ' + client.name };
    }

    var url = 'https://' + creds.subdomain + '.kommo.com/api/v4/webhooks';

    try {
        var res = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': 'Bearer ' + creds.token,
                'Content-Type': 'application/json',
            },
        });

        if (!res.ok) {
            var errBody = await res.json().catch(function() { return null; });
            return { success: false, error: 'HTTP ' + res.status, details: errBody };
        }

        var data = await res.json();
        return { success: true, data: data };
    } catch (err) {
        logger.error('[Kommo Webhooks] Erro ao listar para ' + client.name + ': ' + err.message);
        return { success: false, error: err.message };
    }
}

module.exports = { registerWebhooks, listWebhooks };
