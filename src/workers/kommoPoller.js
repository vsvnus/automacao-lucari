/**
 * KommoPoller — Polling fallback para leads do Kommo
 *
 * Roda a cada 5 minutos e busca leads criados nos ultimos 30 minutos
 * na API do Kommo. Se o lead ainda nao foi processado (via webhook),
 * processa como novo lead. Garante que nenhum lead seja perdido caso
 * o webhook falhe ou nao dispare.
 */

const { logger } = require('../utils/logger');
const kommoHandler = require('../kommoHandler');
const clientManager = require('../clientManager');
const pgService = require('../pgService');

/**
 * Busca leads recentes de um cliente via API Kommo.
 * GET /api/v4/leads?filter[created_at][from]=<30min_atras>&with=contacts&limit=50
 */
async function pollClientLeads(client) {
    var creds = kommoHandler.getClientKommoCredentials(client);
    if (!creds.subdomain || !creds.token) {
        logger.debug('[Kommo Poller] Sem credenciais Kommo para ' + client.name + ', pulando');
        return { client: client.name, polled: 0, newLeads: 0, skipped: 'no_credentials' };
    }

    // Buscar leads criados nos ultimos 30 minutos (janela de overlap com intervalo de 5 min)
    var thirtyMinAgo = Math.floor((Date.now() - 30 * 60 * 1000) / 1000);
    var url = 'https://' + creds.subdomain + '.kommo.com/api/v4/leads?filter[created_at][from]=' + thirtyMinAgo + '&with=contacts&limit=50&order[created_at]=desc';

    try {
        var res = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': 'Bearer ' + creds.token,
                'Content-Type': 'application/json',
            },
        });

        if (!res.ok) {
            logger.warn('[Kommo Poller] Falha ao buscar leads de ' + client.name + ': HTTP ' + res.status);
            return { client: client.name, polled: 0, newLeads: 0, error: 'HTTP ' + res.status };
        }

        var data = await res.json();
        var leads = (data._embedded && data._embedded.leads) || [];

        if (leads.length === 0) {
            logger.debug('[Kommo Poller] ' + client.name + ': nenhum lead novo nos ultimos 30 min');
            await updatePollState(client._db_id, null);
            return { client: client.name, polled: 0, newLeads: 0 };
        }

        var newLeadsCount = 0;
        var lastLeadId = null;

        for (var i = 0; i < leads.length; i++) {
            var lead = leads[i];
            var leadId = lead.id;

            if (!lastLeadId || leadId > lastLeadId) lastLeadId = leadId;

            // Checar se este lead ja foi processado (webhook ou polling anterior)
            var alreadyInserted = await kommoHandler.isLeadAlreadyInserted(leadId);
            if (alreadyInserted) continue;

            // Simular o processamento como se fosse um webhook lead.add
            // Construir o payload no formato que o handler espera
            logger.info('[Kommo Poller] Lead ' + leadId + ' (' + (lead.name || 'sem nome') + ') encontrado via polling para ' + client.name);

            // Extrair custom_fields_values para o formato esperado
            var customFields = (lead.custom_fields_values || []).map(function(f) {
                return {
                    id: f.field_id,
                    name: f.field_name,
                    code: f.field_code,
                    values: f.values,
                };
            });

            var webhookLead = {
                id: lead.id,
                name: lead.name,
                price: lead.price,
                pipeline_id: lead.pipeline_id,
                status_id: lead.status_id,
                date_create: lead.created_at,
                custom_fields: customFields,
            };

            var account = {
                id: client.kommo_account_id,
                subdomain: client.kommo_subdomain || creds.subdomain,
            };

            try {
                var result = await kommoHandler.handleLeadAdded(webhookLead, account, client);
                if (result.status === 'success') {
                    newLeadsCount++;
                    logger.info('[Kommo Poller] Lead ' + leadId + ' processado com sucesso via polling');
                }
            } catch (err) {
                logger.error('[Kommo Poller] Erro ao processar lead ' + leadId + ': ' + err.message);
            }
        }

        await updatePollState(client._db_id, lastLeadId);

        // Invalidar cache apos processar novos leads
        if (newLeadsCount > 0) {
            try {
                var cache = require('../infra/cache');
                await cache.invalidatePattern('dashboard:*');
                await cache.invalidatePattern('keywords:*');
            } catch (err) {
                // Cache invalidation is best-effort
            }
        }

        logger.info('[Kommo Poller] ' + client.name + ': ' + leads.length + ' leads verificados, ' + newLeadsCount + ' novos processados');
        return { client: client.name, polled: leads.length, newLeads: newLeadsCount };
    } catch (err) {
        logger.error('[Kommo Poller] Erro ao buscar leads de ' + client.name + ': ' + err.message);
        return { client: client.name, polled: 0, newLeads: 0, error: err.message };
    }
}

/**
 * Atualiza o estado do polling no banco.
 */
async function updatePollState(clientId, lastLeadId) {
    if (!pgService.isAvailable() || !clientId) return;
    try {
        await pgService.query(
            `INSERT INTO kommo_poll_state (client_id, last_polled_at, last_lead_id, updated_at)
             VALUES ($1, NOW(), $2, NOW())
             ON CONFLICT (client_id) DO UPDATE SET
                last_polled_at = NOW(),
                last_lead_id = COALESCE($2, kommo_poll_state.last_lead_id),
                updated_at = NOW()`,
            [clientId, lastLeadId]
        );
    } catch (err) {
        logger.error('[Kommo Poller] Erro ao atualizar poll_state: ' + err.message);
    }
}

/**
 * Executa polling para todos os clientes com webhook_source kommo ou both.
 */
async function pollAllClients() {
    var clients = clientManager.clients || [];
    var kommoClients = clients.filter(function(c) {
        return c.webhook_source === 'kommo' || c.webhook_source === 'both';
    });

    if (kommoClients.length === 0) {
        logger.debug('[Kommo Poller] Nenhum cliente com Kommo configurado');
        return [];
    }

    logger.info('[Kommo Poller] Iniciando polling para ' + kommoClients.length + ' cliente(s)');

    var results = [];
    for (var i = 0; i < kommoClients.length; i++) {
        var result = await pollClientLeads(kommoClients[i]);
        results.push(result);
    }

    var totalNew = results.reduce(function(sum, r) { return sum + (r.newLeads || 0); }, 0);
    if (totalNew > 0) {
        logger.info('[Kommo Poller] Polling concluido: ' + totalNew + ' lead(s) novo(s) encontrado(s)');
    }

    return results;
}

module.exports = { pollClientLeads, pollAllClients };
