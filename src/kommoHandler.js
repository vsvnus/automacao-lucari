/**
 * KommoHandler — Processa webhooks do Kommo CRM
 *
 * Kommo envia webhooks como application/x-www-form-urlencoded.
 * Quando parseado com extended:true, produz objetos aninhados:
 *   leads[add], leads[update], leads[status], leads[delete]
 *   contacts[add], contacts[update]
 *
 * Deteccao de venda: status_id === 142 (Closed Won, fixo em todas as contas)
 * Deteccao de perda: status_id === 143 (Closed Lost, fixo em todas as contas)
 */

const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { logger } = require('./utils/logger');
const { formatPhoneBR, formatDateBR } = require('./utils/formatter');
const clientManager = require('./clientManager');
const sheetsService = require('./sheetsService');
const pgService = require('./pgService');

const KOMMO_STAGE = {
    CLOSED_WON: 142,
    CLOSED_LOST: 143,
};

/**
 * Garante que o valor seja sempre um array.
 * Kommo pode mandar objeto com chaves numericas em vez de array.
 */
function ensureArray(val) {
    if (!val) return [];
    if (Array.isArray(val)) return val;
    if (typeof val === 'object') return Object.values(val);
    return [val];
}

/**
 * Extrai campo customizado do array custom_fields pelo code ou name.
 */
function extractCustomField(customFields, codeOrName) {
    if (!customFields) return null;
    const fields = ensureArray(customFields);
    for (const field of fields) {
        if (field.code === codeOrName || field.name === codeOrName) {
            const values = ensureArray(field.values);
            if (values.length > 0 && values[0]) {
                return values[0].value || null;
            }
            return null;
        }
    }
    return null;
}

/**
 * Verifica assinatura HMAC-SHA1 do Kommo.
 */
function verifySignature(rawBody, signature, secret) {
    if (!secret) return true; // sem secret configurado, aceita (dev mode)
    if (!signature) return false;
    const expected = crypto
        .createHmac('sha1', secret)
        .update(rawBody)
        .digest('hex');
    try {
        return crypto.timingSafeEqual(
            Buffer.from(signature),
            Buffer.from(expected)
        );
    } catch (e) {
        return false;
    }
}

/**
 * Encontra o cliente pelo pipeline_id do Kommo.
 */
function findClientByPipeline(pipelineId) {
    if (!pipelineId) return null;
    const pid = String(pipelineId);
    const clients = clientManager.clients || [];
    return clients.find(function(c) {
        return (c.webhook_source === 'kommo' || c.webhook_source === 'both') &&
            c.kommo_pipeline_id &&
            String(c.kommo_pipeline_id) === pid;
    }) || null;
}

class KommoHandler {
    /**
     * Processa o webhook completo do Kommo.
     * Chamado APOS responder 200 ao Kommo (processamento assincrono).
     */
    async processWebhook(body, rawBody, signature) {
        const secret = process.env.KOMMO_CLIENT_SECRET;

        // Verificar assinatura
        if (secret && !verifySignature(rawBody || '', signature || '', secret)) {
            logger.warn('[Kommo] Assinatura invalida no webhook');
            return { success: false, error: 'Invalid signature' };
        }

        const account = body.account || {};
        const accountId = account.id || 'unknown';
        const subdomain = account.subdomain || 'unknown';

        logger.info('[Kommo] Webhook recebido - account: ' + subdomain + ' (' + accountId + ')');

        const results = [];

        // Processar eventos de lead
        if (body.leads) {
            if (body.leads.add) {
                for (const lead of ensureArray(body.leads.add)) {
                    results.push(await this.handleLeadAdded(lead, account));
                }
            }
            if (body.leads.update) {
                for (const lead of ensureArray(body.leads.update)) {
                    results.push(await this.handleLeadUpdated(lead, account));
                }
            }
            if (body.leads.status) {
                for (const lead of ensureArray(body.leads.status)) {
                    results.push(await this.handleLeadStatus(lead, account));
                }
            }
        }

        // Processar eventos de contato
        if (body.contacts) {
            if (body.contacts.add) {
                for (const contact of ensureArray(body.contacts.add)) {
                    results.push(await this.handleContactEvent(contact, account, 'add'));
                }
            }
            if (body.contacts.update) {
                for (const contact of ensureArray(body.contacts.update)) {
                    results.push(await this.handleContactEvent(contact, account, 'update'));
                }
            }
        }

        if (results.length === 0) {
            logger.info('[Kommo] Nenhum evento relevante no webhook');
            this.logKommoEvent(null, 'unknown', null, accountId, body, 'ignored');
        }

        return { success: true, processed: results.length, results: results };
    }

    /**
     * Lead adicionado no Kommo.
     */
    async handleLeadAdded(lead, account) {
        const client = findClientByPipeline(lead.pipeline_id);
        const leadId = lead.id;
        const leadName = lead.name || 'Sem nome';
        const price = parseFloat(lead.price) || 0;
        const pipelineId = lead.pipeline_id;
        const statusId = lead.status_id;

        logger.info('[Kommo] Lead adicionado: id=' + leadId + ', name="' + leadName + '", pipeline=' + pipelineId + ', status=' + statusId + ', price=' + price);

        this.logKommoEvent(
            client ? client._db_id : null,
            'lead.add',
            String(leadId),
            String(account.id || ''),
            { lead: lead, account: account },
            client ? 'success' : 'no_client'
        );

        if (!client) {
            logger.warn('[Kommo] Nenhum cliente mapeado para pipeline ' + pipelineId);
            return { type: 'lead.add', leadId: leadId, status: 'no_client' };
        }

        // Inserir na planilha
        try {
            var sheetName = await sheetsService.resolveSheetName(client);
            var createdAt = lead.date_create
                ? new Date(parseInt(lead.date_create, 10) * 1000)
                : new Date();

            var leadData = {
                name: leadName + ' (Kommo)',
                phone: '',
                origin: 'Kommo CRM',
                date: formatDateBR(createdAt.toISOString()),
                product: '',
                status: 'Lead Gerado',
                phoneRaw: '',
                leadId: uuidv4(),
            };

            var result = await sheetsService.insertLead(client, leadData);
            if (result.success) {
                logger.info('[Kommo] Lead inserido na planilha: ' + leadName + ' -> ' + client.name);
                pgService.logLead(client._db_id, {
                    eventType: 'new_lead',
                    phone: '',
                    name: leadData.name,
                    status: 'Lead Gerado',
                    origin: 'Kommo CRM',
                    sheetName: result.sheetName,
                    result: 'success',
                    error: null,
                });
            }
            return { type: 'lead.add', leadId: leadId, status: 'success', client: client.name };
        } catch (err) {
            logger.error('[Kommo] Erro ao inserir lead: ' + err.message);
            return { type: 'lead.add', leadId: leadId, status: 'error', error: err.message };
        }
    }

    /**
     * Lead atualizado no Kommo.
     */
    async handleLeadUpdated(lead, account) {
        var client = findClientByPipeline(lead.pipeline_id);
        var leadId = lead.id;
        var leadName = lead.name || 'Sem nome';

        logger.info('[Kommo] Lead atualizado: id=' + leadId + ', name="' + leadName + '"');

        this.logKommoEvent(
            client ? client._db_id : null,
            'lead.update',
            String(leadId),
            String(account.id || ''),
            { lead: lead, account: account },
            client ? 'success' : 'no_client'
        );

        return { type: 'lead.update', leadId: leadId, status: client ? 'logged' : 'no_client' };
    }

    /**
     * Lead mudou de status/estagio no Kommo.
     * MAIS IMPORTANTE: detecta vendas (142) e perdas (143).
     */
    async handleLeadStatus(lead, account) {
        var statusId = parseInt(lead.status_id, 10);
        var oldStatusId = parseInt(lead.old_status_id, 10);
        var pipelineId = lead.pipeline_id || lead.old_pipeline_id;
        var client = findClientByPipeline(pipelineId);
        var leadId = lead.id;
        var price = parseFloat(lead.price) || 0;

        logger.info('[Kommo] Lead ' + leadId + ' status: ' + oldStatusId + ' -> ' + statusId + ' (pipeline: ' + pipelineId + ')');

        var isSale = statusId === KOMMO_STAGE.CLOSED_WON;
        var isLost = statusId === KOMMO_STAGE.CLOSED_LOST;

        var eventType = isSale ? 'lead.won' : isLost ? 'lead.lost' : 'lead.status';
        this.logKommoEvent(
            client ? client._db_id : null,
            eventType,
            String(leadId),
            String(account.id || ''),
            { lead: lead, account: account },
            client ? 'success' : 'no_client'
        );

        if (!client) {
            logger.warn('[Kommo] Nenhum cliente mapeado para pipeline ' + pipelineId);
            return { type: 'lead.status', leadId: leadId, statusId: statusId, status: 'no_client' };
        }

        if (isSale) {
            logger.info('[Kommo] VENDA DETECTADA! Lead ' + leadId + ' -> Closed Won (R$ ' + price + ') -> ' + client.name);

            try {
                // Buscar telefone vinculado nos eventos anteriores
                var phone = await this.findPhoneForKommoLead(leadId);

                if (phone) {
                    var updateData = {
                        phone: phone,
                        status: 'Comprou (Kommo)',
                        closeDate: formatDateBR(new Date().toISOString()),
                        saleAmount: price,
                    };
                    await sheetsService.updateLeadStatus(client, updateData);

                    // Upsert keyword conversion
                    await pgService.upsertKeywordConversion(phone, {
                        saleAmount: price,
                        leadStatus: 'Comprou (Kommo)',
                    });
                }

                pgService.logLead(client._db_id, {
                    eventType: 'status_update',
                    phone: phone || '',
                    name: 'Kommo Lead #' + leadId,
                    status: 'Comprou (Kommo)',
                    saleAmount: price,
                    origin: 'Kommo CRM',
                    result: 'success',
                    error: null,
                });
            } catch (err) {
                logger.error('[Kommo] Erro ao processar venda: ' + err.message);
            }

            return { type: 'lead.won', leadId: leadId, price: price, client: client.name };
        }

        if (isLost) {
            logger.info('[Kommo] Lead ' + leadId + ' perdido (Closed Lost) -> ' + client.name);

            pgService.logLead(client._db_id, {
                eventType: 'status_update',
                phone: '',
                name: 'Kommo Lead #' + leadId,
                status: 'Perdido (Kommo)',
                origin: 'Kommo CRM',
                result: 'success',
                error: null,
            });

            return { type: 'lead.lost', leadId: leadId, client: client.name };
        }

        // Status intermediario - apenas logar
        return { type: 'lead.status', leadId: leadId, statusId: statusId, client: client.name };
    }

    /**
     * Contato adicionado ou atualizado no Kommo.
     * Extrai telefone e email, vincula ao lead.
     */
    async handleContactEvent(contact, account, action) {
        var contactId = contact.id;
        var contactName = contact.name || '';
        var phone = extractCustomField(contact.custom_fields, 'PHONE');
        var email = extractCustomField(contact.custom_fields, 'EMAIL');
        var linkedLeads = contact.linked_leads_id || [];

        logger.info('[Kommo] Contato ' + action + ': id=' + contactId + ', name="' + contactName + '", phone=' + (phone || 'N/A') + ', email=' + (email || 'N/A') + ', leads=' + JSON.stringify(linkedLeads));

        // Armazenar relacao contato->lead para lookup futuro
        if (phone && linkedLeads.length > 0) {
            for (var i = 0; i < ensureArray(linkedLeads).length; i++) {
                var leadIdStr = String(ensureArray(linkedLeads)[i]);
                this.logKommoEvent(
                    null,
                    'contact.' + action,
                    leadIdStr,
                    String(account.id || ''),
                    { contact: contact, account: account, phone: phone, email: email },
                    'success'
                );
            }
        } else {
            this.logKommoEvent(
                null,
                'contact.' + action,
                null,
                String(account.id || ''),
                { contact: contact, account: account, phone: phone, email: email },
                'logged'
            );
        }

        return { type: 'contact.' + action, contactId: contactId, phone: phone, linkedLeads: linkedLeads };
    }

    /**
     * Busca telefone vinculado a um lead Kommo nos eventos anteriores.
     */
    async findPhoneForKommoLead(kommoLeadId) {
        if (!pgService.isAvailable()) return null;
        try {
            var result = await pgService.query(
                "SELECT payload->>'phone' as phone FROM kommo_events WHERE kommo_lead_id = $1 AND event_type LIKE 'contact.%' AND payload->>'phone' IS NOT NULL ORDER BY created_at DESC LIMIT 1",
                [String(kommoLeadId)]
            );
            if (result.rows.length > 0 && result.rows[0].phone) {
                return String(result.rows[0].phone).replace(/"/g, '');
            }
            return null;
        } catch (err) {
            logger.error('[Kommo] Erro ao buscar telefone do lead ' + kommoLeadId + ': ' + err.message);
            return null;
        }
    }

    /**
     * Salva evento raw no banco kommo_events.
     */
    logKommoEvent(clientId, eventType, kommoLeadId, kommoAccountId, payload, processingResult) {
        if (!pgService.isAvailable()) return;
        pgService.query(
            'INSERT INTO kommo_events (client_id, event_type, kommo_lead_id, kommo_account_id, payload, processing_result) VALUES ($1, $2, $3, $4, $5, $6)',
            [clientId, eventType, kommoLeadId, kommoAccountId, JSON.stringify(payload), processingResult]
        ).catch(function(err) {
            logger.error('[Kommo] Erro ao logar evento: ' + err.message);
        });
    }
}

module.exports = new KommoHandler();
