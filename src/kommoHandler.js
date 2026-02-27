/**
 * KommoHandler — Processa webhooks do Kommo CRM
 *
 * Kommo envia webhooks como application/x-www-form-urlencoded.
 * Quando parseado com extended:true, produz objetos aninhados:
 *   leads[add], leads[update], leads[status], leads[delete]
 *   contacts[add], contacts[update]
 *
 * IMPORTANTE: Kommo frequentemente NAO envia leads[add] para leads criados
 * via Digital Pipeline ou formularios. Leads novos chegam como leads[status]
 * (primeira mudanca de estagio). O handler detecta isso e insere na planilha
 * no primeiro evento de status quando o lead ainda nao foi processado.
 *
 * Matching de cliente: por kommo_account_id (conta Kommo inteira, todos os pipelines)
 * Filtro de origem: campo custom "Fonte de prospeccao" — so trafego pago vai pra planilha
 * Deteccao de venda: status_id === 142 (Closed Won)
 * Deteccao de perda: status_id === 143 (Closed Lost)
 * Telefone: buscado via API Kommo (lead -> contacts embedded -> contact details -> PHONE)
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

// Valores do campo "Fonte de prospeccao" que sao trafego pago
const PAID_SOURCES = ['google ads', 'google', 'meta', 'facebook', 'instagram', 'meta ads', 'facebook ads', 'instagram ads', 'trafego pago', 'cpc', 'ppc'];

// Mapeamento de fonte para canal (para exibir no dashboard/planilha)
function mapSourceToChannel(sourceValue) {
    if (!sourceValue) return 'Desconhecido';
    var val = sourceValue.toLowerCase().trim();
    if (val.match(/google/)) return 'Google Ads';
    if (val.match(/meta|facebook|instagram|fb|ig/)) return 'Meta Ads';
    if (val.match(/trafego|cpc|ppc|paid/)) return 'Trafego Pago';
    return sourceValue; // retorna original se nao mapeou
}

function isPaidSource(sourceValue) {
    if (!sourceValue) return false;
    var val = sourceValue.toLowerCase().trim();
    return PAID_SOURCES.some(function(s) { return val.includes(s); });
}

/**
 * Garante que o valor seja sempre um array.
 */
function ensureArray(val) {
    if (!val) return [];
    if (Array.isArray(val)) return val;
    if (typeof val === 'object') return Object.values(val);
    return [val];
}

/**
 * Extrai campo customizado do array custom_fields pelo code, name ou id.
 */
function extractCustomField(customFields, codeOrName) {
    if (!customFields) return null;
    var fields = ensureArray(customFields);
    for (var i = 0; i < fields.length; i++) {
        var field = fields[i];
        if (field.code === codeOrName || field.name === codeOrName || String(field.id) === String(codeOrName)) {
            var values = ensureArray(field.values);
            if (values.length > 0 && values[0]) {
                return values[0].value || null;
            }
            return null;
        }
    }
    return null;
}

/**
 * Extrai a fonte de prospeccao dos custom_fields do lead.
 */
function extractLeadSource(customFields) {
    // Tentar por nome (portugues e ingles)
    var source = extractCustomField(customFields, 'Fonte de prospecção');
    if (!source) source = extractCustomField(customFields, 'Fonte de prospeccao');
    if (!source) source = extractCustomField(customFields, 'Source');
    if (!source) source = extractCustomField(customFields, 'Origem');
    if (!source) source = extractCustomField(customFields, 'UTM Source');
    return source;
}

/**
 * Verifica assinatura HMAC-SHA1 do Kommo.
 */
function verifySignature(rawBody, signature, secret) {
    if (!secret) return true;
    if (!signature) return false;
    var expected = crypto
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
 * Encontra o cliente pelo account_id do Kommo.
 */
function findClientByAccount(accountId) {
    if (!accountId) return null;
    var aid = String(accountId);
    var clients = clientManager.clients || [];
    return clients.find(function(c) {
        return (c.webhook_source === 'kommo' || c.webhook_source === 'both') &&
            c.kommo_account_id &&
            String(c.kommo_account_id) === aid;
    }) || null;
}

// ---- Kommo API helpers ----

/**
 * Busca detalhes de um lead via API Kommo, incluindo contatos vinculados.
 * GET https://{subdomain}.kommo.com/api/v4/leads/{id}?with=contacts
 */
async function fetchLeadFromAPI(leadId) {
    var subdomain = process.env.KOMMO_SUBDOMAIN;
    var token = process.env.KOMMO_ACCESS_TOKEN;
    if (!subdomain || !token) {
        logger.warn('[Kommo API] KOMMO_SUBDOMAIN ou KOMMO_ACCESS_TOKEN nao configurado');
        return null;
    }
    var url = 'https://' + subdomain + '.kommo.com/api/v4/leads/' + leadId + '?with=contacts';
    try {
        var res = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': 'Bearer ' + token,
                'Content-Type': 'application/json',
            },
        });
        if (!res.ok) {
            logger.warn('[Kommo API] Falha ao buscar lead ' + leadId + ': HTTP ' + res.status);
            return null;
        }
        return await res.json();
    } catch (err) {
        logger.error('[Kommo API] Erro ao buscar lead ' + leadId + ': ' + err.message);
        return null;
    }
}

/**
 * Busca detalhes de um contato via API Kommo.
 * GET https://{subdomain}.kommo.com/api/v4/contacts/{id}
 */
async function fetchContactFromAPI(contactId) {
    var subdomain = process.env.KOMMO_SUBDOMAIN;
    var token = process.env.KOMMO_ACCESS_TOKEN;
    if (!subdomain || !token) return null;
    var url = 'https://' + subdomain + '.kommo.com/api/v4/contacts/' + contactId;
    try {
        var res = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': 'Bearer ' + token,
                'Content-Type': 'application/json',
            },
        });
        if (!res.ok) {
            logger.warn('[Kommo API] Falha ao buscar contato ' + contactId + ': HTTP ' + res.status);
            return null;
        }
        return await res.json();
    } catch (err) {
        logger.error('[Kommo API] Erro ao buscar contato ' + contactId + ': ' + err.message);
        return null;
    }
}

/**
 * Extrai telefone de um contato retornado pela API Kommo.
 * O campo PHONE esta em custom_fields_values com field_code: "PHONE".
 */
function extractPhoneFromContact(contact) {
    if (!contact || !contact.custom_fields_values) return null;
    for (var i = 0; i < contact.custom_fields_values.length; i++) {
        var field = contact.custom_fields_values[i];
        if (field.field_code === 'PHONE') {
            if (field.values && field.values.length > 0) {
                return field.values[0].value || null;
            }
        }
    }
    return null;
}

/**
 * Extrai nome de um contato retornado pela API Kommo.
 */
function extractNameFromContact(contact) {
    if (!contact) return null;
    return contact.name || null;
}

/**
 * Busca telefone e nome do contato principal de um lead via API Kommo.
 * Fluxo: lead (with=contacts) -> contact IDs -> fetch contact -> PHONE
 * Retorna { phone, contactName } ou { phone: null, contactName: null }
 */
async function fetchPhoneViaAPI(leadId) {
    var lead = await fetchLeadFromAPI(leadId);
    if (!lead) return { phone: null, contactName: null };

    // Lead retorna _embedded.contacts com array de { id, is_main }
    var contacts = (lead._embedded && lead._embedded.contacts) || [];
    if (contacts.length === 0) {
        logger.info('[Kommo API] Lead ' + leadId + ' nao tem contatos vinculados');
        return { phone: null, contactName: null };
    }

    // Priorizar contato principal (is_main = true)
    var mainContact = contacts.find(function(c) { return c.is_main; }) || contacts[0];
    var contactData = await fetchContactFromAPI(mainContact.id);
    if (!contactData) return { phone: null, contactName: null };

    var phone = extractPhoneFromContact(contactData);
    var contactName = extractNameFromContact(contactData);

    logger.info('[Kommo API] Lead ' + leadId + ' -> contato ' + mainContact.id + ': phone=' + (phone || 'N/A') + ', name=' + (contactName || 'N/A'));
    return { phone: phone, contactName: contactName };
}

class KommoHandler {
    /**
     * Processa o webhook completo do Kommo.
     * Chamado APOS responder 200 (processamento assincrono).
     */
    async processWebhook(body, rawBody, signature) {
        var secret = process.env.KOMMO_CLIENT_SECRET;

        if (secret && !verifySignature(rawBody || '', signature || '', secret)) {
            logger.warn('[Kommo] Assinatura invalida no webhook');
            return { success: false, error: 'Invalid signature' };
        }

        var account = body.account || {};
        var accountId = account.id || 'unknown';
        var subdomain = account.subdomain || 'unknown';

        logger.info('[Kommo] Webhook recebido - account: ' + subdomain + ' (' + accountId + ')');

        // Encontrar cliente pela conta
        var client = findClientByAccount(accountId);

        var results = [];

        // Processar eventos de lead
        if (body.leads) {
            if (body.leads.add) {
                for (var lead of ensureArray(body.leads.add)) {
                    results.push(await this.handleLeadAdded(lead, account, client));
                }
            }
            if (body.leads.update) {
                for (var lead of ensureArray(body.leads.update)) {
                    results.push(await this.handleLeadUpdated(lead, account, client));
                }
            }
            if (body.leads.status) {
                for (var lead of ensureArray(body.leads.status)) {
                    results.push(await this.handleLeadStatus(lead, account, client));
                }
            }
        }

        // Processar eventos de contato
        if (body.contacts) {
            if (body.contacts.add) {
                for (var contact of ensureArray(body.contacts.add)) {
                    results.push(await this.handleContactEvent(contact, account, 'add'));
                }
            }
            if (body.contacts.update) {
                for (var contact of ensureArray(body.contacts.update)) {
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
     * Verifica se um lead Kommo ja foi inserido na planilha (lead.add ou lead.first_status).
     * Retorna true se ja foi processado como novo lead.
     */
    async isLeadAlreadyInserted(kommoLeadId) {
        if (!pgService.isAvailable()) return false;
        try {
            var result = await pgService.query(
                "SELECT COUNT(*) as cnt FROM kommo_events WHERE kommo_lead_id = $1 AND event_type IN ('lead.add', 'lead.first_status') AND processing_result IN ('success', 'filtered_organic')",
                [String(kommoLeadId)]
            );
            return parseInt(result.rows[0].cnt, 10) > 0;
        } catch (err) {
            logger.error('[Kommo] Erro ao verificar lead ' + kommoLeadId + ': ' + err.message);
            return false;
        }
    }

    /**
     * Insere lead de trafego pago na planilha.
     * Compartilhado entre handleLeadAdded e handleLeadStatus (primeiro evento).
     */
    async insertLeadToSheet(leadId, leadName, lead, client, channel, sourceValue) {
        var sheetName = await sheetsService.resolveSheetName(client);
        var createdAt = lead.date_create
            ? new Date(parseInt(lead.date_create, 10) * 1000)
            : new Date();

        // Buscar telefone via API Kommo (contato vinculado ao lead)
        var apiResult = await fetchPhoneViaAPI(leadId);
        var phone = apiResult.phone;
        var contactName = apiResult.contactName;

        // Se nao encontrou via API, tentar nos eventos anteriores (fallback)
        if (!phone) {
            phone = await this.findPhoneForKommoLead(leadId);
        }

        // Usar nome do contato se disponivel (mais completo que o nome do lead)
        var displayName = contactName || leadName || (phone ? formatPhoneBR(phone) : 'Lead Kommo');

        var leadData = {
            name: displayName + ' (Kommo)',
            phone: phone ? formatPhoneBR(phone) : '',
            origin: channel,
            date: formatDateBR(createdAt.toISOString()),
            product: '',
            status: 'Lead Gerado',
            phoneRaw: phone || '',
            leadId: uuidv4(),
        };

        var result = await sheetsService.insertLead(client, leadData);
        if (result.success) {
            logger.info('[Kommo] Lead inserido na planilha: ' + displayName + ' -> ' + client.name + ' (' + channel + ') phone=' + (phone || 'N/A'));
            pgService.logLead(client._db_id, {
                eventType: 'new_lead',
                phone: phone || '',
                name: leadData.name,
                status: 'Lead Gerado',
                origin: channel,
                sheetName: result.sheetName,
                result: 'success',
                error: null,
            });
        } else {
            logger.error('[Kommo] Falha ao inserir lead na planilha: ' + (result.error || 'erro desconhecido'));
            pgService.logLead(client._db_id, {
                eventType: 'new_lead',
                phone: phone || '',
                name: leadData.name,
                status: 'Erro',
                origin: channel,
                result: 'failed',
                error: 'Falha Planilha: ' + (result.error || 'erro desconhecido'),
            });
        }

        return { success: result.success, phone: phone, displayName: displayName };
    }

    /**
     * Lead adicionado no Kommo.
     * Filtra por trafego pago antes de inserir na planilha.
     * Busca telefone via API Kommo (nao depende de evento de contato).
     */
    async handleLeadAdded(lead, account, client) {
        var leadId = lead.id;
        var leadName = lead.name || 'Sem nome';
        var pipelineId = lead.pipeline_id;
        var accountId = String(account.id || '');

        // Detectar origem pelo custom field
        var sourceValue = extractLeadSource(lead.custom_fields);
        var channel = mapSourceToChannel(sourceValue);
        var isPaid = isPaidSource(sourceValue);

        logger.info('[Kommo] Lead adicionado: id=' + leadId + ', name="' + leadName + '", pipeline=' + pipelineId + ', fonte="' + (sourceValue || 'N/A') + '" (' + channel + ')');

        this.logKommoEvent(
            client ? client._db_id : null,
            'lead.add',
            String(leadId),
            accountId,
            { lead: lead, account: account, detectedSource: sourceValue, detectedChannel: channel, isPaid: isPaid },
            client ? (isPaid ? 'success' : 'filtered_organic') : 'no_client'
        );

        if (!client) {
            logger.warn('[Kommo] Nenhum cliente mapeado para account ' + accountId);
            return { type: 'lead.add', leadId: leadId, status: 'no_client' };
        }

        // Filtrar organico — mesmo comportamento do Tintim
        if (!isPaid) {
            logger.info('[Kommo] Lead organico ignorado: ' + leadName + ' — fonte: ' + (sourceValue || 'nenhuma') + ' (' + channel + ')');
            pgService.logLead(client._db_id, {
                eventType: 'new_lead',
                phone: '',
                name: leadName + ' (Kommo)',
                status: 'Ignorado (Organico)',
                origin: channel,
                result: 'filtered',
                error: null,
            });
            return { type: 'lead.add', leadId: leadId, status: 'filtered_organic', source: sourceValue };
        }

        // Lead de trafego pago — buscar telefone via API e inserir na planilha
        try {
            var insertResult = await this.insertLeadToSheet(leadId, leadName, lead, client, channel, sourceValue);
            return { type: 'lead.add', leadId: leadId, status: 'success', client: client.name, channel: channel, phone: insertResult.phone || null };
        } catch (err) {
            logger.error('[Kommo] Erro ao inserir lead: ' + err.message);
            return { type: 'lead.add', leadId: leadId, status: 'error', error: err.message };
        }
    }

    /**
     * Lead atualizado no Kommo.
     */
    async handleLeadUpdated(lead, account, client) {
        var leadId = lead.id;
        var leadName = lead.name || 'Sem nome';
        var accountId = String(account.id || '');

        logger.info('[Kommo] Lead atualizado: id=' + leadId + ', name="' + leadName + '"');

        this.logKommoEvent(
            client ? client._db_id : null,
            'lead.update',
            String(leadId),
            accountId,
            { lead: lead, account: account },
            client ? 'logged' : 'no_client'
        );

        return { type: 'lead.update', leadId: leadId, status: client ? 'logged' : 'no_client' };
    }

    /**
     * Lead mudou de status/estagio no Kommo.
     *
     * IMPORTANTE: Kommo frequentemente NAO envia leads[add]. Leads novos
     * chegam como leads[status] (primeira mudanca de estagio). Quando vemos
     * um lead pela primeira vez aqui, inserimos na planilha como lead novo.
     *
     * Detecta vendas (142) e perdas (143).
     * Busca telefone via API Kommo.
     */
    async handleLeadStatus(lead, account, client) {
        var statusId = parseInt(lead.status_id, 10);
        var oldStatusId = parseInt(lead.old_status_id, 10);
        var pipelineId = lead.pipeline_id || lead.old_pipeline_id;
        var leadId = lead.id;
        var leadName = lead.name || '';
        var price = parseFloat(lead.price) || 0;
        var accountId = String(account.id || '');

        var sourceValue = extractLeadSource(lead.custom_fields);
        var channel = mapSourceToChannel(sourceValue);
        var isPaid = isPaidSource(sourceValue);

        logger.info('[Kommo] Lead ' + leadId + ' (' + (leadName || 'sem nome') + ') status: ' + oldStatusId + ' -> ' + statusId + ' (pipeline: ' + pipelineId + ', fonte: ' + (sourceValue || 'N/A') + ')');

        var isSale = statusId === KOMMO_STAGE.CLOSED_WON;
        var isLost = statusId === KOMMO_STAGE.CLOSED_LOST;

        if (!client) {
            var eventType = isSale ? 'lead.won' : isLost ? 'lead.lost' : 'lead.status';
            this.logKommoEvent(null, eventType, String(leadId), accountId,
                { lead: lead, account: account, detectedSource: sourceValue, detectedChannel: channel },
                'no_client'
            );
            logger.warn('[Kommo] Nenhum cliente mapeado para account ' + accountId);
            return { type: 'lead.status', leadId: leadId, statusId: statusId, status: 'no_client' };
        }

        // Verificar se este lead ja foi inserido na planilha
        var alreadyInserted = await this.isLeadAlreadyInserted(leadId);

        // Se nunca foi inserido e nao eh venda/perda, tratar como lead novo
        if (!alreadyInserted && !isSale && !isLost) {
            logger.info('[Kommo] Primeiro evento de status para lead ' + leadId + ' — tratando como lead novo');

            this.logKommoEvent(
                client._db_id,
                'lead.first_status',
                String(leadId),
                accountId,
                { lead: lead, account: account, detectedSource: sourceValue, detectedChannel: channel, isPaid: isPaid },
                isPaid ? 'success' : 'filtered_organic'
            );

            if (!isPaid) {
                logger.info('[Kommo] Lead organico ignorado: ' + (leadName || leadId) + ' — fonte: ' + (sourceValue || 'nenhuma') + ' (' + channel + ')');
                pgService.logLead(client._db_id, {
                    eventType: 'new_lead',
                    phone: '',
                    name: (leadName || 'Lead #' + leadId) + ' (Kommo)',
                    status: 'Ignorado (Organico)',
                    origin: channel,
                    result: 'filtered',
                    error: null,
                });
                return { type: 'lead.first_status', leadId: leadId, status: 'filtered_organic', source: sourceValue };
            }

            try {
                var insertResult = await this.insertLeadToSheet(leadId, leadName, lead, client, channel, sourceValue);
                return { type: 'lead.first_status', leadId: leadId, status: 'success', client: client.name, channel: channel, phone: insertResult.phone || null };
            } catch (err) {
                logger.error('[Kommo] Erro ao inserir lead (first_status): ' + err.message);
                return { type: 'lead.first_status', leadId: leadId, status: 'error', error: err.message };
            }
        }

        // Lead ja processado anteriormente ou eh venda/perda — log normal
        var eventType = isSale ? 'lead.won' : isLost ? 'lead.lost' : 'lead.status';
        this.logKommoEvent(
            client._db_id,
            eventType,
            String(leadId),
            accountId,
            { lead: lead, account: account, detectedSource: sourceValue, detectedChannel: channel },
            'success'
        );

        if (isSale) {
            logger.info('[Kommo] VENDA DETECTADA! Lead ' + leadId + ' (' + leadName + ') -> Closed Won (R$ ' + price + ') -> ' + client.name);

            // Se ainda nao foi inserido, inserir primeiro
            if (!alreadyInserted && isPaid) {
                logger.info('[Kommo] Lead ' + leadId + ' nunca inserido — inserindo antes de marcar venda');
                try {
                    await this.insertLeadToSheet(leadId, leadName, lead, client, channel, sourceValue);
                    // Marcar como inserted para nao duplicar
                    this.logKommoEvent(client._db_id, 'lead.first_status', String(leadId), accountId,
                        { lead: lead, account: account, note: 'inserted_on_sale' }, 'success');
                } catch (err) {
                    logger.error('[Kommo] Erro ao inserir lead na venda: ' + err.message);
                }
            }

            try {
                // Buscar telefone via API Kommo
                var apiResult = await fetchPhoneViaAPI(leadId);
                var phone = apiResult.phone;

                // Fallback: buscar nos eventos anteriores
                if (!phone) {
                    phone = await this.findPhoneForKommoLead(leadId);
                }

                if (phone) {
                    var updateData = {
                        phone: phone,
                        status: 'Comprou (Kommo)',
                        closeDate: formatDateBR(new Date().toISOString()),
                        saleAmount: price,
                    };
                    await sheetsService.updateLeadStatus(client, updateData);

                    await pgService.upsertKeywordConversion(phone, {
                        saleAmount: price,
                        leadStatus: 'Comprou (Kommo)',
                    });
                } else {
                    logger.warn('[Kommo] Venda sem telefone para lead ' + leadId + ' — nao foi possivel atualizar planilha');
                }

                pgService.logLead(client._db_id, {
                    eventType: 'status_update',
                    phone: phone || '',
                    name: leadName ? leadName + ' (Kommo)' : 'Kommo Lead #' + leadId,
                    status: 'Comprou (Kommo)',
                    saleAmount: price,
                    origin: channel || 'Kommo CRM',
                    result: 'success',
                    error: null,
                });
            } catch (err) {
                logger.error('[Kommo] Erro ao processar venda: ' + err.message);
            }

            return { type: 'lead.won', leadId: leadId, price: price, client: client.name };
        }

        if (isLost) {
            logger.info('[Kommo] Lead ' + leadId + ' (' + leadName + ') perdido (Closed Lost) -> ' + client.name);

            pgService.logLead(client._db_id, {
                eventType: 'status_update',
                phone: '',
                name: leadName ? leadName + ' (Kommo)' : 'Kommo Lead #' + leadId,
                status: 'Perdido (Kommo)',
                origin: channel || 'Kommo CRM',
                result: 'success',
                error: null,
            });

            return { type: 'lead.lost', leadId: leadId, client: client.name };
        }

        // Status intermediario de lead ja processado
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

        if (phone && linkedLeads.length > 0) {
            var leadsArr = ensureArray(linkedLeads);
            for (var i = 0; i < leadsArr.length; i++) {
                var leadIdStr = String(leadsArr[i]);
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
     * Busca telefone vinculado a um lead Kommo nos eventos anteriores (fallback).
     * Usado quando a API nao retorna contato (ex: contato criado depois).
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
