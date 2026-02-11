/**
 * Formatter — Formatação de dados para padrão da planilha do cliente
 */

/**
 * Formata telefone de "5533988836450" para "(33)98883-6450"
 * Segue o padrão que o cliente já usa na planilha (sem espaço após DDD)
 */
function formatPhoneBR(phone) {
    if (!phone) return '';

    const digits = phone.replace(/\D/g, '');
    const national = digits.startsWith('55') ? digits.slice(2) : digits;

    if (national.length === 11) {
        // Celular: (XX)XXXXX-XXXX
        return `(${national.slice(0, 2)})${national.slice(2, 7)}-${national.slice(7)}`;
    } else if (national.length === 10) {
        // Fixo: (XX)XXXX-XXXX
        return `(${national.slice(0, 2)})${national.slice(2, 6)}-${national.slice(6)}`;
    }

    // Telefones mais curtos (sem DDD completo) — retorna como (XX)XXXXXXX
    if (national.length >= 8) {
        return `(${national.slice(0, 2)})${national.slice(2)}`;
    }

    return phone;
}

/**
 * Retorna a data no formato DD/MM/YYYY (padrão da planilha)
 * Ex: "2026-02-10T14:30:00" → "10/02/2026"
 */
function formatDateBR(isoString) {
    let date;

    if (!isoString) {
        date = new Date();
    } else {
        try {
            date = new Date(isoString);
        } catch {
            date = new Date();
        }
    }

    // Converter para timezone BR
    const brOptions = { timeZone: 'America/Sao_Paulo' };
    const day = date.toLocaleDateString('pt-BR', { ...brOptions, day: '2-digit' });
    const month = date.toLocaleDateString('pt-BR', { ...brOptions, month: '2-digit' });
    const year = date.toLocaleDateString('pt-BR', { ...brOptions, year: 'numeric' });

    return `${day}/${month}/${year}`;
}

module.exports = { formatPhoneBR, formatDateBR };
