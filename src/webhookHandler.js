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

const { v4: uuidv4 } = require("uuid");
const { logger, logLead } = require("./utils/logger");
const { validateTintimPayload } = require("./utils/validator");
const { formatPhoneBR, formatDateBR } = require("./utils/formatter");
const clientManager = require("./clientManager");
const sheetsService = require("./sheetsService");
const pgService = require("./pgService");

/**
 * Regras de detecção de produto.
 */
const PRODUCT_KEYWORDS = [
    { product: "BPC/LOAS", keywords: ["bpc", "loas", "benefício", "beneficio", "deficiência", "deficiencia", "idoso"] },
    { product: "SALÁRIO-MATERNIDADE", keywords: ["maternidade", "gestante", "grávida", "gravida", "bebê", "bebe", "salário-maternidade", "salario maternidade"] },
    { product: "AUXÍLIO-DOENÇA", keywords: ["auxílio-doença", "auxilio doenca", "doença", "doenca", "afastamento", "incapacidade"] },
    { product: "APOSENTADORIA", keywords: ["aposentadoria", "aposentar", "inss", "tempo de contribuição"] },
];

const SALE_STATUS_KEYWORDS = [
    "venda", "vendido", "fechou", "fechado", "ganho", "ganhou",
    "convertido", "contrato", "assinado", "pago", "pagou",
    "comprou", "comprado",
    "sale", "won", "closed",
];

function isSaleStatus(statusName) {
    if (!statusName) return false;
    const normalized = statusName.toLowerCase().trim();
    return SALE_STATUS_KEYWORDS.some(kw => normalized.includes(kw));
}

function detectOrigin(payload) {
    // 1. ctwa_clid — Click-to-WhatsApp Ad ID do Meta (prioridade máxima)
    if (payload.ctwa_clid && payload.ctwa_clid.length > 4) {
        return { channel: "Meta Ads", comment: "Lead chegou via Click-to-WhatsApp Ad (Meta)" };
    }

    // 2. Objeto nested payload.ad (Tintim envia ad_name, campaign_name dentro de ad{})
    if (payload.ad && typeof payload.ad === "object") {
        const adFields = [
            payload.ad.ad_name, payload.ad.adName,
            payload.ad.campaign_name, payload.ad.campaignName,
            payload.ad.adset_name, payload.ad.adSetName,
        ].filter(Boolean).join(" ").toLowerCase();

        if (adFields.length > 0) {
            if (adFields.match(/google|gclid|search|pmax/)) {
                return { channel: "Google Ads", comment: "Lead chegou pelo Google Ads (ad nested)" };
            }
            // Se tem dados de ad mas não é Google, é Meta
            return { channel: "Meta Ads", comment: "Lead chegou no Wpp pelo Meta (ad nested)" };
        }
    }

    // 3. Campos source/channel/medium (top-level)
    const source = (payload.source || "").toLowerCase();
    const channel = (payload.channel || "").toLowerCase();
    const medium = (payload.medium || "").toLowerCase();
    const utmSource = (payload.utmSource || payload.utm_source || "").toLowerCase();
    const utmMedium = (payload.utmMedium || payload.utm_medium || "").toLowerCase();
    const allFields = [source, channel, medium, utmSource, utmMedium].join(" ");

    if (allFields.match(/google|gclid|g_ads|googleads|search|pmax|performance.max/)) {
        return { channel: "Google Ads", comment: "Lead chegou pelo Google Ads" };
    }
    if (allFields.match(/meta|facebook|instagram|fb|ig|fbclid|meta_ads/)) {
        return { channel: "Meta Ads", comment: "Lead chegou no Wpp pelo Meta" };
    }
    if (allFields.match(/cpc|cpm|paid|ads|ppc/)) {
        return { channel: "Tráfego Pago", comment: "Lead chegou via tráfego pago" };
    }

    // 4. Campos de campanha (top-level)
    const campaignFields = [
        payload.utmCampaign, payload.utm_campaign, payload.campaign,
        payload.adName, payload.ad_name, payload.adSetName, payload.adset_name,
    ].filter(Boolean).join(" ").toLowerCase();

    if (campaignFields.match(/google|gclid|search|pmax/)) {
        return { channel: "Google Ads", comment: "Lead chegou pelo Google Ads" };
    }
    if (campaignFields.match(/meta|facebook|instagram|fb|ig/)) {
        return { channel: "Meta Ads", comment: "Lead chegou no Wpp pelo Meta" };
    }

    return { channel: "WhatsApp", comment: "Lead chegou via WhatsApp" };
}

function detectProduct(payload) {
    const campaignFields = [
        payload.utmCampaign, payload.utm_campaign, payload.campaign,
        payload.adName, payload.ad_name, payload.adSetName, payload.adset_name,
    ].filter(Boolean).join(" ").toLowerCase();

    if (campaignFields) {
        for (const rule of PRODUCT_KEYWORDS) {
            if (rule.keywords.some(kw => campaignFields.includes(kw))) {
                logger.info(`Produto detectado por campanha: ${rule.product}`);
                return rule.product;
            }
        }
    }

    const message = (payload.text?.message || "").toLowerCase();
    if (message) {
        for (const rule of PRODUCT_KEYWORDS) {
            if (rule.keywords.some(kw => message.includes(kw))) {
                logger.info(`Produto detectado por mensagem: ${rule.product}`);
                return rule.product;
            }
        }
    }

    return "";
}

function isStatusUpdate(payload) {
    if (payload.event_type === "lead.create") return false;
    if (payload.event_type === "lead.update") return true;
    if (payload.sale_amount && parseFloat(payload.sale_amount) > 0) return true;
    return false;
}

function extractStatusName(payload) {
    if (payload.status && typeof payload.status === "object") return payload.status.name || null;
    if (payload.status && typeof payload.status === "string") return payload.status;
    return null;
}

function extractStatusId(payload) {
    if (payload.status && typeof payload.status === "object") return payload.status.id || null;
    return null;
}

// Helper: trail tracker para um webhook
class TrailTracker {
    constructor(traceId) {
        this.traceId = traceId;
        this.stepCount = 0;
        this.lastTime = Date.now();
    }

    async step(stepName, status, detail, metadata) {
        this.stepCount++;
        const now = Date.now();
        const durationMs = now - this.lastTime;
        this.lastTime = now;
        await pgService.addTrailStep(this.traceId, this.stepCount, stepName, status, detail, metadata, durationMs);
    }
}

class WebhookHandler {
    async processWebhook(rawPayload) {
        const traceId = uuidv4();
        const trail = new TrailTracker(traceId);

        logger.info("📦 Payload COMPLETO do Tintim:", { fullPayload: JSON.stringify(rawPayload) });

        // Step 1: webhook_received
        const phone = rawPayload.phone || rawPayload.phone_e164 || "";
        const eventType = rawPayload.event_type || "";
        await trail.step("webhook_received", "ok", `Webhook recebido: ${eventType || "sem tipo"} | ${phone || "sem telefone"}`, { payload: rawPayload });

        // Step 2: duplicate_check
        if (phone && eventType) {
            const isDuplicate = await pgService.checkDuplicateWebhook(phone, eventType, 30);
            if (isDuplicate) {
                logger.info("⚡ Webhook duplicado ignorado (idempotência)", { phone, eventType });
                await trail.step("duplicate_check", "skipped", "Webhook duplicado ignorado (idempotência)", { phone, eventType });
                return { success: true, message: "Duplicado ignorado", traceId };
            }
        }
        await trail.step("duplicate_check", "ok", "Não é duplicado", { phone, eventType });

        // Step 3: payload_validated
        const validation = validateTintimPayload(rawPayload);
        if (!validation.valid) {
            logger.warn("Payload inválido", { errors: validation.errors });
            await trail.step("payload_validated", "error", `Payload inválido: ${validation.errors.join(", ")}`, { errors: validation.errors });
            pgService.logWebhookEvent(rawPayload, null, "invalid");
            return { success: false, errors: validation.errors, traceId };
        }
        const payload = validation.payload;
        await trail.step("payload_validated", "ok", "Payload válido e normalizado", { instanceId: payload.instanceId, chatName: payload.chatName });

        logger.info("📋 Payload normalizado:", {
            instanceId: payload.instanceId,
            chatName: payload.chatName,
            phone: payload.phone || payload.phone_e164,
            eventType: payload.event_type,
            moment: payload.moment,
        });

        // Filter unknown event types
        const KNOWN_EVENTS = ["lead.create", "lead.update"];
        if (payload.event_type && !KNOWN_EVENTS.includes(payload.event_type)) {
            logger.warn(`Evento ignorado pelo sistema: ${payload.event_type}`);
            await trail.step("payload_validated", "skipped", `Evento desconhecido ignorado: ${payload.event_type}`, { eventType: payload.event_type });
            pgService.logWebhookEvent(payload, null, "ignored_type");
            return { success: true, message: `Evento ${payload.event_type} ignorado`, traceId };
        }

        // Step 4: client_matched
        const client = clientManager.findByInstanceId(payload.instanceId);
        if (!client) {
            logger.warn("Nenhum cliente para instanceId", { instanceId: payload.instanceId });
            await trail.step("client_matched", "error", `Nenhum cliente encontrado para instanceId: ${payload.instanceId}`, { instanceId: payload.instanceId });
            logLead(payload, "NO_CLIENT", { instanceId: payload.instanceId });
            pgService.logWebhookEvent(payload, null, "no_client");
            return { success: false, error: "Cliente não encontrado", traceId };
        }
        await trail.step("client_matched", "ok", `Cliente identificado: ${client.name}`, { clientSlug: client.slug, clientName: client.name });

        // Step 5+: processar
        let result;
        if (isStatusUpdate(payload)) {
            result = await this.processStatusUpdate(payload, client, trail);
        } else {
            result = await this.processNewLead(payload, client, trail);
        }

        if (result.type !== "filtered") {
            pgService.logWebhookEvent(payload, client.id, result.success ? "success" : "failed");
        }

        result.traceId = traceId;
        return result;
    }

    async processNewLead(payload, client, trail) {
        const phone = payload.phone || payload.phone_e164?.replace("+", "") || "";

        logger.info(`📥 Novo lead recebido para: ${client.name}`, { phone, chatName: payload.chatName, eventType: payload.event_type });

        // origin_detected
        const origin = detectOrigin(payload);
        await trail.step("origin_detected", "ok", `Origem: ${origin.channel}`, { channel: origin.channel, source: payload.source, utmSource: payload.utm_source || payload.utmSource });

        // organic_filtered
        const PAID_CHANNELS = ["Meta Ads", "Google Ads", "Tráfego Pago"];
        if (!PAID_CHANNELS.includes(origin.channel)) {
            logger.info(`🚫 Lead orgânico ignorado: ${payload.chatName || phone} — origem: ${origin.channel}`);
            await trail.step("organic_filtered", "skipped", `Lead orgânico filtrado (${origin.channel})`, { phone, channel: origin.channel, client: client.name });

            pgService.logLead(client.id, { eventType: "new_lead", phone, name: payload.chatName || phone, status: "Ignorado (Orgânico)", origin: origin.channel, result: "filtered", error: null, leadDate: payload.moment || null });
            pgService.logWebhookEvent(payload, client.id, "filtered_organic");

            return { success: true, message: "Lead orgânico ignorado (sem campanha)", type: "filtered" };
        }

        // product_detected
        let product = "";
        try {
            product = detectProduct(payload);
        } catch (err) {
            logger.warn("Falha na detecção de produto", { error: err.message });
            await trail.step("product_detected", "error", `Falha na detecção de produto: ${err.message}`, { error: err.message });
            pgService.logLead(client.id, { eventType: "new_lead", phone, name: payload.chatName, status: "Erro", result: "failed", error: `Falha técnica: Detecção de produto (${err.message})`, leadDate: payload.moment || null });
            return { success: false, error: err.message, type: "new_lead" };
        }
        await trail.step("product_detected", "ok", product ? `Produto: ${product}` : "Produto não identificado", { product });

        // keyword_extracted - save Google Ads keyword data
        if (origin.channel === "Google Ads") {
            const keywordData = {
                clientId: client.id,
                keyword: payload.utm_term || (payload.visit && payload.visit.params && payload.visit.params.utm_term) || null,
                campaign: payload.utm_campaign || (payload.visit && payload.visit.params && payload.visit.params.utm_campaign) || null,
                utmSource: payload.utm_source || "google",
                utmMedium: payload.utm_medium || "cpc",
                utmContent: payload.utm_content || null,
                gclid: (payload.visit && payload.visit.params && payload.visit.params.gclid) || null,
                landingPage: (payload.visit && payload.visit.name) || null,
                deviceType: (payload.visit && payload.visit.meta && payload.visit.meta.http_user_agent && payload.visit.meta.http_user_agent.device && payload.visit.meta.http_user_agent.device.type) || null,
                locationState: (payload.location && payload.location.state) || null,
                leadPhone: phone,
                leadName: payload.chatName || "",
                leadStatus: extractStatusName(payload) || "Lead Gerado",
                product: product,
            };
            await pgService.saveKeywordConversion(keywordData);
            await trail.step("keyword_extracted", "ok",
                `Keyword: "${keywordData.keyword || "N/A"}" | Campaign: ${keywordData.campaign || "N/A"}`,
                { keyword: keywordData.keyword, campaign: keywordData.campaign });
        }

        // sheet_resolved
        let sheetName;
        try {
            sheetName = await sheetsService.resolveSheetName(client, trail.traceId);
            await trail.step("sheet_resolved", "ok", `Aba determinada: ${sheetName}`, { sheetName, spreadsheetId: client.spreadsheet_id });
        } catch (err) {
            await trail.step("sheet_resolved", "error", `Falha ao resolver aba: ${err.message}`, { error: err.message });
            pgService.logLead(client.id, { eventType: "new_lead", phone, name: payload.chatName, status: "Erro", result: "failed", error: `Falha ao resolver aba: ${err.message}`, leadDate: payload.moment || null });
            return { success: false, error: err.message, type: "new_lead" };
        }

        // lead_inserted
        const leadId = uuidv4();
        const leadData = {
            name: (payload.chatName || formatPhoneBR(phone)) + " (Auto)",
            phone: formatPhoneBR(phone),
            origin: origin.channel,
            date: formatDateBR(payload.moment),
            product: product,
            status: "Lead Gerado",
            phoneRaw: phone,
            message: payload.text?.message || "",
            messageId: payload.messageId || "",
            leadId,
        };

        let result = { success: false, error: "Iniciado" };
        try {
            result = await sheetsService.insertLead(client, leadData);
        } catch (err) {
            result = { success: false, error: `Erro de conexão com Google Sheets: ${err.message}` };
        }

        if (result.success) {
            await trail.step("lead_inserted", "ok", `Lead inserido na linha da aba ${result.sheetName}`, { leadName: leadData.name, phone: leadData.phone, sheetName: result.sheetName });
            logLead(leadData, "SUCCESS", { client: client.name, sheet: result.sheetName });
            logger.info(`✅ Lead inserido: ${leadData.name} → ${client.name} (${result.sheetName})${product ? ` [${product}]` : ""}`);
            pgService.logLead(client.id, { eventType: "new_lead", phone: payload.phone, name: leadData.name, status: "Lead Gerado", product, origin: origin.channel, sheetName: result.sheetName, result: "success", error: null, leadDate: payload.moment || null });
        } else {
            const errorMsg = result.error || "Erro desconhecido na inserção";
            await trail.step("lead_inserted", "error", `Falha ao inserir lead: ${errorMsg}`, { error: errorMsg, client: client.name });
            logLead(leadData, "FAILED", { client: client.name, error: errorMsg });
            logger.error("❌ Falha ao inserir lead", { error: errorMsg });
            pgService.logLead(client.id, { eventType: "new_lead", phone: payload.phone, name: leadData.name, status: "Erro", product, origin: origin.channel, result: "failed", error: `Falha Planilha: ${errorMsg}`, leadDate: payload.moment || null });
        }

        return { success: result.success, leadId, client: client.name, type: "new_lead" };
    }

    async processStatusUpdate(payload, client, trail) {
        const statusName = extractStatusName(payload);
        const statusId = extractStatusId(payload);
        const saleAmount = payload.sale_amount || null;
        const leadName = payload.name || payload.chatName || "Desconhecido";

        logger.info(`🔄 Atualização de status para: ${client.name}`, { phone: payload.phone, leadName, eventType: payload.event_type, statusId, newStatus: statusName, saleAmount, source: payload.source });

        // origin_detected
        const origin = detectOrigin(payload);
        await trail.step("origin_detected", "ok", `Origem: ${origin.channel}`, { channel: origin.channel });

        const updateData = {
            phone: payload.phone,
            status: statusName,
            name: payload.chatName ? (payload.chatName + " (Auto)") : undefined,
        };

        if (isSaleStatus(statusName) || saleAmount) {
            updateData.closeDate = formatDateBR(new Date().toISOString());
            if (saleAmount) {
                updateData.saleAmount = parseFloat(saleAmount);
            }
            // Upsert keyword conversion for ANY sale (lead may have come from Google Ads originally)
            const salePhone = payload.phone || payload.phone_e164?.replace("+", "") || "";
            if (salePhone) {
                await pgService.upsertKeywordConversion(salePhone, {
                    saleAmount: saleAmount ? parseFloat(saleAmount) : 0,
                    leadStatus: statusName,
                });
            }
        }

        // status_updated
        let result = { success: false, error: "Iniciado" };
        try {
            result = await sheetsService.updateLeadStatus(client, updateData);
        } catch (err) {
            result = { success: false, error: `Erro conexão Google Sheets: ${err.message}` };
        }

        // sale_recovered — se lead não encontrado
        const isNotFound = result.error && (result.error.includes("Lead não encontrado") || result.error.includes("não encontrado na planilha"));

        if (!result.success && isNotFound && (isSaleStatus(statusName) || saleAmount)) {
            // Não re-filtrar por canal aqui — o payload de update geralmente não traz dados de anúncio
            // (ctwa_clid, ad{}, utm_*), então detectOrigin classificaria erroneamente como orgânico.
            // A filtragem já aconteceu na inserção original do lead.
            logger.warn("⚠️ Lead não encontrado para atualização de venda. Tentando inserir como novo...", { phone: payload.phone });
            await trail.step("sale_recovered", "ok", "Tentando recuperar venda (lead não encontrado na planilha)", { phone: payload.phone, channel: origin.channel });

            const recoveryLeadData = {
                name: (payload.chatName || formatPhoneBR(payload.phone)) + " (Recuperado)",
                phone: formatPhoneBR(payload.phone),
                origin: origin.channel,
                date: formatDateBR(new Date().toISOString()),
                product: detectProduct(payload) || "Indefinido",
                status: "Venda (Cliente não encontrado)",
                phoneRaw: payload.phone,
                leadId: uuidv4(),
                saleAmount: saleAmount ? parseFloat(saleAmount) : 0,
                closeDate: formatDateBR(new Date().toISOString()),
            };

            let insertResult = { success: false, error: "Iniciado recovery" };
            try {
                insertResult = await sheetsService.insertLead(client, recoveryLeadData);
            } catch (err) {
                insertResult = { success: false, error: `Erro inserção recovery: ${err.message}` };
            }

            if (insertResult.success) {
                logger.info(`✅ Venda recuperada! Lead inserido: ${recoveryLeadData.name}`);
                await trail.step("lead_inserted", "ok", `Venda recuperada e inserida em ${insertResult.sheetName}`, { leadName: recoveryLeadData.name, recovered: true });
                result = { success: true, sheetName: insertResult.sheetName, row: insertResult.row, recovered: true };
            } else {
                logger.error("❌ Falha ao tentar recuperar venda", { error: insertResult.error });
                await trail.step("lead_inserted", "error", `Falha ao recuperar venda: ${insertResult.error}`, { error: insertResult.error });
            }
        }

        if (result.success) {
            logger.info(`✅ Status atualizado: ${payload.chatName || payload.phone} → "${statusName}"${saleAmount ? ` (R$ ${saleAmount})` : ""} [linha ${result.row}]`);
            await trail.step("status_updated", "ok", `Status "${statusName}" atualizado com sucesso${result.recovered ? " (venda recuperada)" : ""}`, { status: statusName, row: result.row, sheetName: result.sheetName, recovered: result.recovered || false });

            pgService.logLead(client.id, { eventType: "status_update", phone: payload.phone, name: leadName, status: statusName, saleAmount: saleAmount ? parseFloat(saleAmount) : (isSaleStatus(statusName) ? 0 : null), sheetName: result.sheetName, sheetRow: result.row, result: "success", error: null, leadDate: payload.moment || null });
        } else {
            const errorMsg = result.error || "Erro desconhecido na atualização";
            logger.warn("⚠️ Não foi possível atualizar status", { error: errorMsg, phone: payload.phone });
            await trail.step("status_updated", "error", `Falha ao atualizar status: ${errorMsg}`, { error: errorMsg, phone: payload.phone, status: statusName });

            pgService.logLead(client.id, { eventType: "status_update", phone: payload.phone, name: leadName, status: "Erro Update", saleAmount: saleAmount ? parseFloat(saleAmount) : (isSaleStatus(statusName) ? 0 : null), result: "failed", error: `Falha Planilha: ${errorMsg}`, leadDate: payload.moment || null });
        }

        return { success: result.success, client: client.name, type: "status_update", status: statusName, saleAmount, recovered: result.recovered };
    }
}

module.exports = new WebhookHandler();
