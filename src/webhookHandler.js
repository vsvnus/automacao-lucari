/**
 * WebhookHandler — Processa webhooks do Tintim
 * 
 * Mapeamento para colunas da planilha:
 *   A: Nome do Lead     ← chatName
 *   B: Telefone          ← phone (formatado)
 *   C: Meio de Contato   ← "WhatsApp"
 *   D: Data 1º Contato   ← moment (formatado DD/MM/YYYY)
 *   E-F: Preenchidos pela equipe
 *   G: Produto           ← Auto-detectado por keywords ou campanha
 *   H: Status Lead       ← "Lead Gerado"
 *   I-N: Preenchidos pela equipe
 */

const { v4: uuidv4 } = require('uuid');
const { logger, logLead } = require('./utils/logger');
const { validateTintimPayload } = require('./utils/validator');
const { formatPhoneBR, formatDateBR } = require('./utils/formatter');
const clientManager = require('./clientManager');
const sheetsService = require('./sheetsService');

/**
 * Regras de detecção de produto.
 * Verifica a mensagem do lead e dados de campanha/UTM.
 * Retorna o produto mais provável ou vazio se não identificar.
 */
const PRODUCT_KEYWORDS = [
    { product: 'BPC/LOAS', keywords: ['bpc', 'loas', 'benefício', 'beneficio', 'deficiência', 'deficiencia', 'idoso'] },
    { product: 'SALÁRIO-MATERNIDADE', keywords: ['maternidade', 'gestante', 'grávida', 'gravida', 'bebê', 'bebe', 'salário-maternidade', 'salario maternidade'] },
    { product: 'AUXÍLIO-DOENÇA', keywords: ['auxílio-doença', 'auxilio doenca', 'doença', 'doenca', 'afastamento', 'incapacidade'] },
    { product: 'APOSENTADORIA', keywords: ['aposentadoria', 'aposentar', 'inss', 'tempo de contribuição'] },
];

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
            return { success: false, errors: validation.errors };
        }

        // 2. Identificar cliente pela instanceId
        const client = clientManager.findByInstanceId(payload.instanceId);
        if (!client) {
            logger.warn('Nenhum cliente para instanceId', { instanceId: payload.instanceId });
            logLead(payload, 'NO_CLIENT', { instanceId: payload.instanceId });
            return { success: false, error: 'Cliente não encontrado' };
        }

        logger.info(`Lead recebido para: ${client.name}`, {
            phone: payload.phone,
            chatName: payload.chatName,
        });

        // 3. Detectar produto automaticamente
        const product = detectProduct(payload);

        // 4. Formatar dados para a planilha
        const leadId = uuidv4();
        const leadData = {
            name: payload.chatName || 'Não informado',      // Col A
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

        // 5. Inserir na planilha
        const result = await sheetsService.insertLead(client, leadData);

        if (result.success) {
            logLead(leadData, 'SUCCESS', { client: client.name, sheet: result.sheetName });
            logger.info(`✅ Lead inserido: ${leadData.name} → ${client.name} (${result.sheetName})${product ? ` [${product}]` : ''}`);
        } else {
            logLead(leadData, 'FAILED', { client: client.name, error: result.error });
            logger.error(`❌ Falha ao inserir lead`, { error: result.error });
        }

        return { success: result.success, leadId, client: client.name };
    }
}

module.exports = new WebhookHandler();
