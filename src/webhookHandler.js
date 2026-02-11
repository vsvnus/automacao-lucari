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
    'sale', 'won', 'closed',
];

function isSaleStatus(statusName) {
    if (!statusName) return false;
    const normalized = statusName.toLowerCase().trim();
    return SALE_STATUS_KEYWORDS.some(kw => normalized.includes(kw));
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
 *   event_type: "lead.create" ou ausente → conversa criada (novo lead)
 */
function isStatusUpdate(payload) {
    // Método principal: campo event_type
    if (payload.event_type === 'lead.update') {
        return true;
    }
    // Fallback: se tem status ou sale_amount mas sem event_type
    if (payload.status && typeof payload.status === 'object' && payload.status.name) {
        return true;
    }
    if (payload.sale_amount !== undefined && payload.sale_amount !== null) {
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
    async processWebhook(payload) {
        // LOG COMPLETO do payload (para debug e entender o que o Tintim manda)
        logger.info('📦 Payload COMPLETO do Tintim:', {
            fullPayload: JSON.stringify(payload),
        });

        // 1. Validar payload
        const validation = validateTintimPayload(payload);
        if (!validation.valid) {
            logger.warn('Payload inválido', { errors: validation.errors });
            supabaseService.logWebhookEvent(payload, null, 'invalid');
            return { success: false, errors: validation.errors };
        }

        // 2. Identificar cliente pela instanceId
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
        supabaseService.logWebhookEvent(payload, client.id, result.success ? 'success' : 'failed');

        return result;
    }

    /**
     * Processa um NOVO LEAD (conversa criada)
     */
    async processNewLead(payload, client) {
        logger.info(`📥 Novo lead recebido para: ${client.name}`, {
            phone: payload.phone,
            chatName: payload.chatName,
        });

        // Detectar produto automaticamente
        const product = detectProduct(payload);

        // Formatar dados para a planilha
        const leadId = uuidv4();
        const leadData = {
            name: (payload.chatName || 'Não informado') + ' (Auto)',  // Col A — tag de automação
            phone: formatPhoneBR(payload.phone),             // Col B
            origin: 'WhatsApp',                              // Col C
            date: formatDateBR(payload.moment),              // Col D
            product: product,                                // Col G (auto-detectado)
            status: 'Lead Gerado',                           // Col H
            // Extras para log
            phoneRaw: payload.phone,
            message: payload.text?.message || '',
            messageId: payload.messageId || '',
            leadId,
        };

        // Inserir na planilha
        const result = await sheetsService.insertLead(client, leadData);

        if (result.success) {
            logLead(leadData, 'SUCCESS', { client: client.name, sheet: result.sheetName });
            logger.info(`✅ Lead inserido: ${leadData.name} → ${client.name} (${result.sheetName})${product ? ` [${product}]` : ''}`);
        } else {
            logLead(leadData, 'FAILED', { client: client.name, error: result.error });
            logger.error(`❌ Falha ao inserir lead`, { error: result.error });
        }

        // Registrar no Supabase (auditoria)
        supabaseService.logLead(client.id, {
            eventType: 'new_lead',
            phone: payload.phone,
            name: leadData.name,
            status: 'Lead Gerado',
            product: product,
            origin: 'WhatsApp',
            sheetName: result.sheetName,
            result: result.success ? 'success' : 'failed',
            error: result.error,
        });

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
        const result = await sheetsService.updateLeadStatus(client, updateData);

        if (result.success) {
            logger.info(`✅ Status atualizado: ${payload.chatName || payload.phone} → "${statusName}"${saleAmount ? ` (R$ ${saleAmount})` : ''} [linha ${result.row}]`);
        } else {
            logger.warn(`⚠️ Não foi possível atualizar status`, {
                error: result.error,
                phone: payload.phone,
            });
        }

        // Registrar no Supabase (auditoria)
        supabaseService.logLead(client.id, {
            eventType: 'status_update',
            phone: payload.phone,
            name: leadName,
            status: statusName,
            saleAmount: saleAmount ? parseFloat(saleAmount) : null,
            sheetName: result.sheetName,
            sheetRow: result.row,
            result: result.success ? 'success' : 'failed',
            error: result.error,
        });

        return {
            success: result.success,
            client: client.name,
            type: 'status_update',
            status: statusName,
            saleAmount,
        };
    }
}

module.exports = new WebhookHandler();
