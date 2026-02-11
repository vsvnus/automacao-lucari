/**
 * Validator — Validação de payloads do Tintim
 * 
 * Suporta DOIS formatos de payload:
 *   1. Formato REAL do webhook Tintim (event_type: lead.create / lead.update)
 *      → instanceId em account.code, data em created_isoformat, nome em name
 *   2. Formato legado/API (usado nos testes antigos)
 *      → instanceId na raiz, data em moment, nome em chatName
 */

const { logger } = require('./logger');

/**
 * Normaliza o payload do Tintim para um formato canônico.
 * Aceita tanto o formato real do webhook quanto o formato legado.
 * 
 * Retorna o payload original COM os campos canônicos injetados:
 *   - instanceId (extraído de account.code se necessário)
 *   - chatName (extraído de name ou account.name se necessário)
 *   - moment (extraído de created_isoformat ou first_interaction_at se necessário)
 */
function normalizeTintimPayload(payload) {
    if (!payload) return payload;

    const normalized = { ...payload };

    // ── instanceId ──────────────────────────────────────────
    // Formato real: account.code | Formato legado: instanceId
    if (!normalized.instanceId && normalized.account?.code) {
        normalized.instanceId = normalized.account.code;
        logger.debug('instanceId extraído de account.code');
    }

    // ── chatName (nome do lead) ─────────────────────────────
    // Formato real: name | Formato legado: chatName
    if (!normalized.chatName) {
        normalized.chatName = normalized.name || null;
    }

    // ── moment (data/hora do evento) ────────────────────────
    // Formato real: created_isoformat / first_interaction_at | Formato legado: moment
    if (!normalized.moment) {
        normalized.moment = normalized.created_isoformat
            || normalized.first_interaction_at
            || normalized.updated_isoformat
            || new Date().toISOString();
    }

    // ── senderName ──────────────────────────────────────────
    if (!normalized.senderName && normalized.account?.name) {
        normalized.senderName = normalized.account.name;
    }

    return normalized;
}

/**
 * Valida o payload do webhook do Tintim.
 * Retorna { valid, errors, payload } onde payload é o normalizado.
 */
function validateTintimPayload(payload) {
    const errors = [];

    if (!payload) {
        return { valid: false, errors: ['Payload vazio'], payload };
    }

    // Normalizar primeiro
    const normalized = normalizeTintimPayload(payload);

    // Validar campos obrigatórios
    if (!normalized.phone && !normalized.phone_e164) {
        errors.push('Campo "phone" é obrigatório');
    }

    if (!normalized.instanceId) {
        errors.push('Campo "instanceId" (ou account.code) é obrigatório');
    }

    // Se é mensagem do próprio remetente (empresa), ignorar
    // Nota: no formato real do Tintim, fromMe não está presente
    if (normalized.fromMe === true) {
        return { valid: false, errors: ['Mensagem enviada pela empresa (fromMe=true), ignorando'], payload: normalized };
    }

    return {
        valid: errors.length === 0,
        errors,
        payload: normalized,
    };
}

module.exports = { validateTintimPayload, normalizeTintimPayload };
