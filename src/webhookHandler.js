/**
 * WebhookHandler — Processa webhooks do Tintim
 * 
 * Suporta dois tipos de evento:
 *   1. CONVERSA CRIADA → Insere lead novo na planilha
 *   2. CONVERSA ALTERADA → Atualiza status do lead existente
 * 
 * Mapeamento para colunas da planilha:
 *   A: Nome do Lead     ← chatName
 *   B: Telefone          ← phone (formatado)
 *   C: Meio de Contato   ← "WhatsApp"
 *   D: Data 1º Contato   ← moment (formatado DD/MM/YYYY)
 *   E: Data Fechamento   ← Preenchido na atualização de status (venda)
 *   F: Valor Fechamento  ← sale_amount do Tintim
 *   G: Produto           ← Auto-detectado por keywords ou campanha
 *   H: Status Lead       ← "Lead Gerado" (novo) / Status do Tintim (atualização)
 *   I-M: DIA 1-5         ← Preenchidos pela equipe
 *   N: Comentários       ← Registro automático
 */

const { v4: uuidv4 } = require('uuid');
const { logger, logLead } = require('./utils/logger');
const { validateTintimPayload } = require('./utils/validator');
const { formatPhoneBR, formatDateBR } = require('./utils/formatter');
const clientManager = require('./clientManager');
const sheetsService = require('./sheetsService');
const supabaseService = require('./supabaseService');

/**
 * Regras de detecção de produto.
 */
const PRODUCT_KEYWORDS = [
    { product: 'BPC/LOAS', keywords: ['bpc', 'loas', 'benefício', 'beneficio', 'deficiência', 'deficiencia', 'idoso'] },
    { product: 'SALÁRIO-MATERNIDADE', keywords: ['maternidade', 'gestante', 'grávida', 'gravida', 'bebê', 'bebe', 'salário-maternidade', 'salario maternidade'] },
    { product: 'AUXÍLIO-DOENÇA', keywords: ['auxílio-doença', 'auxilio doenca', 'doença', 'doenca', 'afastamento', 'incapacidade'] },
    { product: 'APOSENTADORIA', keywords: ['aposentadoria', 'aposentar', 'inss', 'tempo de contribuição'] },
];

/**
 * Status do Tintim que indicam VENDA/FECHAMENTO.
 * Quando o Tintim envia esses status, atualizamos a planilha com data e valor.
 */
const SALE_STATUS_KEYWORDS = [
    'venda', 'vendido', 'fechou', 'fechado', 'ganho', 'ganhou',
    'convertido', 'contrato', 'assinado', 'pago', 'pagou',
    'comprou', 'comprado',
    'sale', 'won', 'closed',
];

function isSaleStatus(statusName) {
    if (!statusName) return false;
    const normalized = statusName.toLowerCase().trim();
    return SALE_STATUS_KEYWORDS.some(kw => normalized.includes(kw));
}

/**
 * Detecta a ORIGEM/CANAL do lead a partir do payload do Tintim.
 * Retorna { channel, comment } onde:
 *   channel = "Meta Ads" | "Google Ads" | "WhatsApp Orgânico" | "WhatsApp"
 *   comment = texto descritivo para a coluna Comentários da planilha
 */
function detectOrigin(payload) {
    // Campos do Tintim que indicam a origem
    const source = (payload.source || '').toLowerCase();
    const channel = (payload.channel || '').toLowerCase();
    const medium = (payload.medium || '').toLowerCase();
    const utmSource = (payload.utmSource || payload.utm_source || '').toLowerCase();
    const utmMedium = (payload.utmMedium || payload.utm_medium || '').toLowerCase();
    const allFields = [source, channel, medium, utmSource, utmMedium].join(' ');

    // Google Ads
    if (allFields.match(/google|gclid|g_ads|googleads|search|pmax|performance.max/)) {
        return { channel: 'Google Ads', comment: 'Lead chegou pelo Google Ads' };
    }

    // Meta / Facebook / Instagram Ads
    if (allFields.match(/meta|facebook|instagram|fb|ig|fbclid|meta_ads/)) {
        return { channel: 'Meta Ads', comment: 'Lead chegou no Wpp pelo Meta' };
    }

    // Tráfego pago genérico (CPC/CPM mas sem identificar a plataforma)
    if (allFields.match(/cpc|cpm|paid|ads|ppc/)) {
        return { channel: 'Tráfego Pago', comment: 'Lead chegou via tráfego pago' };
    }

    // Checar UTM params como fallback adicional
    const campaignFields = [
        payload.utmCampaign, payload.utm_campaign, payload.campaign,
        payload.adName, payload.ad_name, payload.adSetName, payload.adset_name,
    ].filter(Boolean).join(' ').toLowerCase();

    if (campaignFields.match(/google|gclid|search|pmax/)) {
        return { channel: 'Google Ads', comment: 'Lead chegou pelo Google Ads' };
    }
    if (campaignFields.match(/meta|facebook|instagram|fb|ig/)) {
        return { channel: 'Meta Ads', comment: 'Lead chegou no Wpp pelo Meta' };
    }

    // WhatsApp orgânico (default)
    return { channel: 'WhatsApp', comment: 'Lead chegou via WhatsApp' };
}

function detectProduct(payload) {
    // 1. Tentar por dados de campanha/UTM (se o Tintim enviar)
    const campaignFields = [
        payload.utmCampaign,
        payload.utm_campaign,
        payload.campaign,
        payload.adName,
        payload.ad_name,
        payload.adSetName,
        payload.adset_name,
    ].filter(Boolean).join(' ').toLowerCase();

    if (campaignFields) {
        for (const rule of PRODUCT_KEYWORDS) {
            if (rule.keywords.some(kw => campaignFields.includes(kw))) {
                logger.info(`Produto detectado por campanha: ${rule.product}`);
                return rule.product;
            }
        }
    }

    // 2. Tentar por mensagem do lead
    const message = (payload.text?.message || '').toLowerCase();
    if (message) {
        for (const rule of PRODUCT_KEYWORDS) {
            if (rule.keywords.some(kw => message.includes(kw))) {
                logger.info(`Produto detectado por mensagem: ${rule.product}`);
                return rule.product;
            }
        }
    }

    // 3. Não identificado
    return '';
}

/**
 * Detecta se o webhook é uma ATUALIZAÇÃO DE STATUS ou um NOVO LEAD.
 * 
 * Confirmado pela documentação do Tintim:
 *   event_type: "lead.update" → conversa alterada (atualização de status)
 *   event_type: "lead.create" → conversa criada (novo lead)
 * 
 * IMPORTANTE: O payload de lead.create TAMBÉM tem campo status (ex: "Fez Contato"),
 * por isso devemos checar event_type PRIMEIRO antes de usar heurísticas.
 */
function isStatusUpdate(payload) {
    // Método principal: campo event_type (prioridade máxima)
    if (payload.event_type === 'lead.create') {
        return false; // Explicitamente NÃO é update
    }
    if (payload.event_type === 'lead.update') {
        return true;
    }

    // Fallback (sem event_type): heurísticas para formato legado
    // Só considerar update se tem sale_amount > 0 (indicando venda)
    if (payload.sale_amount && parseFloat(payload.sale_amount) > 0) {
        return true;
    }
    return false;
}

/**
 * Extrai o nome do status do payload.
 * Formato confirmado do Tintim: { status: { id: 123, name: "Nome" } }
 */
function extractStatusName(payload) {
    if (payload.status && typeof payload.status === 'object') {
        return payload.status.name || null;
    }
    if (payload.status && typeof payload.status === 'string') {
        return payload.status;
    }
    return null;
}

/**
 * Extrai o ID do status (útil para mapeamento futuro)
 */
function extractStatusId(payload) {
    if (payload.status && typeof payload.status === 'object') {
        return payload.status.id || null;
    }
    return null;
}

class WebhookHandler {
    async processWebhook(rawPayload) {
        // LOG COMPLETO do payload (para debug e entender o que o Tintim manda)
        logger.info('📦 Payload COMPLETO do Tintim:', {
            fullPayload: JSON.stringify(rawPayload),
        });

        // 0. Verificação de idempotência — evitar reprocessamento de webhooks duplicados
        const phone = rawPayload.phone || rawPayload.phone_e164 || '';
        const eventType = rawPayload.event_type || '';
        if (phone && eventType) {
            const isDuplicate = await supabaseService.checkDuplicateWebhook(phone, eventType, 30);
            if (isDuplicate) {
                logger.info('⚡ Webhook duplicado ignorado (idempotência)', { phone, eventType });
                return { success: true, message: 'Duplicado ignorado' };
            }
        }

        // 1. Validar e NORMALIZAR payload
        const validation = validateTintimPayload(rawPayload);
        if (!validation.valid) {
            logger.warn('Payload inválido', { errors: validation.errors });
            supabaseService.logWebhookEvent(rawPayload, null, 'invalid');
            return { success: false, errors: validation.errors };
        }

        // Usar payload normalizado (campos canônicos injetados)
        const payload = validation.payload;

        logger.info('📋 Payload normalizado:', {
            instanceId: payload.instanceId,
            chatName: payload.chatName,
            phone: payload.phone || payload.phone_e164,
            eventType: payload.event_type,
            moment: payload.moment,
        });

        // 1.5. Filtrar eventos desconhecidos (evitar ruído)
        // Se event_type existir, DEVE ser um dos conhecidos. Se não existir (legado), passa.
        const KNOWN_EVENTS = ['lead.create', 'lead.update'];
        if (payload.event_type && !KNOWN_EVENTS.includes(payload.event_type)) {
            logger.warn(`Evento ignorado pelo sistema: ${payload.event_type}`);
            supabaseService.logWebhookEvent(payload, null, 'ignored_type');
            return { success: true, message: `Evento ${payload.event_type} ignorado` };
        }

        // 2. Identificar cliente pela instanceId (normalizado de account.code)
        const client = clientManager.findByInstanceId(payload.instanceId);
        if (!client) {
            logger.warn('Nenhum cliente para instanceId', { instanceId: payload.instanceId });
            logLead(payload, 'NO_CLIENT', { instanceId: payload.instanceId });
            supabaseService.logWebhookEvent(payload, null, 'no_client');
            return { success: false, error: 'Cliente não encontrado' };
        }

        // 3. Decidir: é novo lead ou atualização de status?
        let result;
        if (isStatusUpdate(payload)) {
            result = await this.processStatusUpdate(payload, client);
        } else {
            result = await this.processNewLead(payload, client);
        }

        // 4. Salvar evento no Supabase (async, não bloqueia)
        // Nota: leads filtrados já logam dentro de processNewLead/processStatusUpdate
        if (result.type !== 'filtered') {
            supabaseService.logWebhookEvent(payload, client.id, result.success ? 'success' : 'failed');
        }

        return result;
    }

    /**
     * Processa um NOVO LEAD (conversa criada)
     */
    async processNewLead(payload, client) {
        const phone = payload.phone || payload.phone_e164?.replace('+', '') || '';

        logger.info(`📥 Novo lead recebido para: ${client.name}`, {
            phone: phone,
            chatName: payload.chatName,
            eventType: payload.event_type,
        });

        // Etapa 1: Detecção de Produto
        let product = '';
        try {
            product = detectProduct(payload);
        } catch (err) {
            logger.warn('Falha na detecção de produto', { error: err.message });
            supabaseService.logLead(client.id, {
                eventType: 'new_lead',
                phone: phone,
                name: payload.chatName,
                status: 'Erro',
                result: 'failed',
                error: `Falha técnica: Detecção de produto (${err.message})`
            });
        }

        // Etapa 2: Detecção de Origem (Meta, Google, WhatsApp orgânico)
        const origin = detectOrigin(payload);
        logger.info(`📡 Origem detectada: ${origin.channel}`, { source: payload.source, utmSource: payload.utm_source || payload.utmSource });

        // Etapa 2.5: FILTRO — Apenas leads de tráfego pago vão para a planilha
        // Conversas orgânicas do WhatsApp (sem tracking de campanha) são ignoradas
        const PAID_CHANNELS = ['Meta Ads', 'Google Ads'];
        if (!PAID_CHANNELS.includes(origin.channel)) {
            logger.info(`🚫 Lead orgânico ignorado (sem campanha): ${payload.chatName || phone} — origem: ${origin.channel}`, {
                phone: phone,
                channel: origin.channel,
                client: client.name,
            });

            supabaseService.logLead(client.id, {
                eventType: 'new_lead',
                phone: phone,
                name: payload.chatName || phone,
                status: 'Ignorado (Orgânico)',
                origin: origin.channel,
                result: 'filtered',
                error: null,
            });

            supabaseService.logWebhookEvent(payload, client.id, 'filtered_organic');

            return { success: true, message: 'Lead orgânico ignorado (sem campanha)', type: 'filtered' };
        }

        // Etapa 3: Preparação de Dados
        const leadId = uuidv4();
        const leadData = {
            name: (payload.chatName || formatPhoneBR(phone)) + ' (Auto)',
            phone: formatPhoneBR(phone),
            origin: origin.channel,
            originComment: origin.comment,
            date: formatDateBR(payload.moment),
            product: product,
            status: extractStatusName(payload) || 'Lead Gerado',
            phoneRaw: phone,
            message: payload.text?.message || '',
            messageId: payload.messageId || '',
            leadId,
        };

        // Etapa 3: Inserção na Planilha
        let result = { success: false, error: 'Iniciado' };
        try {
            result = await sheetsService.insertLead(client, leadData);
        } catch (err) {
            // Captura erros de rede/api do Google
            result = { success: false, error: `Erro de conexão com Google Sheets: ${err.message}` };
        }

        // Etapa 4: Logging do Resultado
        if (result.success) {
            logLead(leadData, 'SUCCESS', { client: client.name, sheet: result.sheetName });
            logger.info(`✅ Lead inserido: ${leadData.name} → ${client.name} (${result.sheetName})${product ? ` [${product}]` : ''}`);

            supabaseService.logLead(client.id, {
                eventType: 'new_lead',
                phone: payload.phone,
                name: leadData.name,
                status: 'Lead Gerado',
                product: product,
                origin: origin.channel,
                sheetName: result.sheetName,
                result: 'success',
                error: null,
            });
        } else {
            const errorMsg = result.error || 'Erro desconhecido na inserção';
            logLead(leadData, 'FAILED', { client: client.name, error: errorMsg });
            logger.error(`❌ Falha ao inserir lead`, { error: errorMsg });

            supabaseService.logLead(client.id, {
                eventType: 'new_lead',
                phone: payload.phone,
                name: leadData.name,
                status: 'Erro',
                product: product,
                origin: origin.channel,
                result: 'failed',
                error: `Falha Planilha: ${errorMsg}`,
            });
        }

        return { success: result.success, leadId, client: client.name, type: 'new_lead' };
    }

    /**
     * Processa uma ATUALIZAÇÃO DE STATUS (conversa alterada)
     */
    async processStatusUpdate(payload, client) {
        const statusName = extractStatusName(payload);
        const statusId = extractStatusId(payload);
        const saleAmount = payload.sale_amount || null;
        const leadName = payload.name || payload.chatName || 'Desconhecido';

        logger.info(`🔄 Atualização de status para: ${client.name}`, {
            phone: payload.phone,
            leadName: leadName,
            eventType: payload.event_type,
            statusId: statusId,
            newStatus: statusName,
            saleAmount: saleAmount,
            source: payload.source,
        });

        // Preparar dados de atualização
        const updateData = {
            phone: payload.phone, // Usar telefone bruto para busca flexível
            status: statusName,
            name: payload.chatName ? (payload.chatName + ' (Auto)') : undefined,
        };

        // Se é status de VENDA, adicionar data de fechamento e valor
        if (isSaleStatus(statusName) || saleAmount) {
            updateData.closeDate = formatDateBR(new Date().toISOString());
            updateData.comment = `Status atualizado para "${statusName}" via Tintim`;

            if (saleAmount) {
                updateData.saleAmount = parseFloat(saleAmount);
                updateData.comment += ` | Valor: R$ ${parseFloat(saleAmount).toFixed(2).replace('.', ',')}`;
            }
        } else {
            // Qualquer outro status (ex: "em atendimento", "sem interesse")
            updateData.comment = `Status atualizado para "${statusName}" via Tintim`;
        }

        // Atualizar na planilha
        let result = { success: false, error: 'Iniciado' };
        try {
            result = await sheetsService.updateLeadStatus(client, updateData);
        } catch (err) {
            result = { success: false, error: `Erro conexão Google Sheets: ${err.message}` };
        }

        // 2. Se falhar porque o lead não existe, TENTAR INSERIR COMO NOVO (Recuperação de Venda)
        // Check robusto para erro de "não encontrado"
        const isNotFound = result.error && (
            result.error.includes('Lead não encontrado') ||
            result.error.includes('não encontrado na planilha')
        );

        if (!result.success && isNotFound && (isSaleStatus(statusName) || saleAmount)) {
            // Verificar origem antes de recuperar — só inserir se for tráfego pago
            const recoveryOrigin = detectOrigin(payload);
            const PAID_CHANNELS = ['Meta Ads', 'Google Ads'];
            if (!PAID_CHANNELS.includes(recoveryOrigin.channel)) {
                logger.info(`🚫 Recuperação de venda ignorada (lead orgânico): ${payload.chatName || payload.phone}`, {
                    phone: payload.phone,
                    channel: recoveryOrigin.channel,
                });
                return { success: true, message: 'Venda orgânica ignorada (sem campanha)', type: 'filtered' };
            }

            logger.warn(`⚠️ Lead não encontrado para atualização de venda. Tentando inserir como novo...`, { phone: payload.phone });

            const recoveryLeadData = {
                name: (payload.chatName || formatPhoneBR(payload.phone)) + ' (Recuperado)',
                phone: formatPhoneBR(payload.phone),
                origin: recoveryOrigin.channel,
                date: formatDateBR(new Date().toISOString()), // Data atual
                product: detectProduct(payload) || 'Indefinido',
                status: `Venda (Cliente não encontrado)`, // Status especial
                phoneRaw: payload.phone,
                leadId: uuidv4(),
                saleAmount: saleAmount ? parseFloat(saleAmount) : 0,
                closeDate: formatDateBR(new Date().toISOString()),
            };

            let insertResult = { success: false, error: 'Iniciado recovery' };
            try {
                insertResult = await sheetsService.insertLead(client, recoveryLeadData);
            } catch (err) {
                insertResult = { success: false, error: `Erro inserção recovery: ${err.message}` };
            }

            if (insertResult.success) {
                logger.info(`✅ Venda recuperada! Lead inserido: ${recoveryLeadData.name}`);

                // Sobrescrever resultado para sucesso (com ressalva)
                result = { success: true, sheetName: insertResult.sheetName, row: insertResult.row, recovered: true };

                // Ajustar status para log
                // statusName = `Venda (Recuperada)`;
            } else {
                logger.error(`❌ Falha ao tentar recuperar venda`, { error: insertResult.error });
            }
        }

        if (result.success) {
            logger.info(`✅ Status atualizado: ${payload.chatName || payload.phone} → "${statusName}"${saleAmount ? ` (R$ ${saleAmount})` : ''} [linha ${result.row}]`);

            supabaseService.logLead(client.id, {
                eventType: 'status_update',
                phone: payload.phone,
                name: leadName,
                status: statusName,
                saleAmount: saleAmount ? parseFloat(saleAmount) : null,
                sheetName: result.sheetName,
                sheetRow: result.row,
                result: 'success',
                error: null,
                details: result.recovered ? 'Venda inserida pois lead não existia na planilha' : null
            });

        } else {
            const errorMsg = result.error || 'Erro desconhecido na atualização';
            logger.warn(`⚠️ Não foi possível atualizar status`, {
                error: errorMsg,
                phone: payload.phone,
            });

            supabaseService.logLead(client.id, {
                eventType: 'status_update',
                phone: payload.phone,
                name: leadName,
                status: 'Erro Update',
                saleAmount: saleAmount ? parseFloat(saleAmount) : null,
                result: 'failed',
                error: `Falha Planilha: ${errorMsg}`,
            });
        }

        return {
            success: result.success,
            client: client.name,
            type: 'status_update',
            status: statusName,
            saleAmount,
            recovered: result.recovered
        };
    }
}

module.exports = new WebhookHandler();
