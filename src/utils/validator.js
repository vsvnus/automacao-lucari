/**
 * Validator — Validação de payloads do Tintim
 */

const { logger } = require('./logger');

/**
 * Valida o payload do webhook do Tintim
 * Campos obrigatórios: phone, instanceId
 */
function validateTintimPayload(payload) {
    const errors = [];

    if (!payload) {
        return { valid: false, errors: ['Payload vazio'] };
    }

    if (!payload.phone) {
        errors.push('Campo "phone" é obrigatório');
    }

    if (!payload.instanceId) {
        errors.push('Campo "instanceId" é obrigatório');
    }

    // Se é mensagem do próprio remetente (empresa), ignorar
    if (payload.fromMe === true) {
        return { valid: false, errors: ['Mensagem enviada pela empresa (fromMe=true), ignorando'] };
    }

    return {
        valid: errors.length === 0,
        errors,
    };
}

module.exports = { validateTintimPayload };
