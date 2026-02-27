/**
 * Alerts — Telegram notification sender
 *
 * Reuses TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID from env.
 * Includes cooldown to prevent spam (default 30 minutes per alert type).
 */

const { logger } = require('../utils/logger');

const COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes
const cooldowns = new Map();

async function sendTelegram(message) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (!token || !chatId) {
        logger.debug('Telegram not configured, skipping alert');
        return false;
    }

    try {
        const url = `https://api.telegram.org/bot${token}/sendMessage`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text: message,
                parse_mode: 'HTML',
                disable_web_page_preview: true,
            }),
        });

        if (!res.ok) {
            logger.warn('Telegram send failed', { status: res.status });
            return false;
        }
        return true;
    } catch (err) {
        logger.error('Telegram send error', { error: err.message });
        return false;
    }
}

async function sendAlert(alertType, message) {
    const lastSent = cooldowns.get(alertType) || 0;
    if (Date.now() - lastSent < COOLDOWN_MS) {
        logger.debug('Alert cooldown active', { alertType });
        return false;
    }

    const prefix = `<b>[Lucari Alert]</b>\n<b>${alertType}</b>\n\n`;
    const sent = await sendTelegram(prefix + message);
    if (sent) {
        cooldowns.set(alertType, Date.now());
    }
    return sent;
}

module.exports = { sendAlert, sendTelegram };
