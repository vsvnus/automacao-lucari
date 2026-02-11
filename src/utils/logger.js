/**
 * Logger — Sistema de logging centralizado usando Winston
 * 
 * Logs são gravados em:
 *   - Console (colorido, para desenvolvimento)
 *   - logs/combined.log (todos os logs)
 *   - logs/error.log (apenas erros)
 *   - logs/leads.log (registro de todos os leads processados)
 */

const winston = require('winston');
const path = require('path');

const logsDir = path.join(__dirname, '..', '..', 'logs');

// Formato customizado para o console
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `[${timestamp}] ${level}: ${message}${metaStr}`;
  })
);

// Formato para arquivos
const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.json()
);

// Logger principal
const logger = winston.createLogger({
  level: process.env.DEBUG_MODE === 'true' ? 'debug' : 'info',
  format: fileFormat,
  transports: [
    // Console
    new winston.transports.Console({ format: consoleFormat }),

    // Todos os logs
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),

    // Apenas erros
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      maxsize: 5242880,
      maxFiles: 5,
    }),
  ],
});

// Logger dedicado para leads (auditoria)
const leadsLogger = winston.createLogger({
  level: 'info',
  format: fileFormat,
  transports: [
    new winston.transports.File({
      filename: path.join(logsDir, 'leads.log'),
      maxsize: 10485760, // 10MB
      maxFiles: 10,
    }),
  ],
});

/**
 * Registra um lead processado no log de auditoria
 */
function logLead(leadData, status, details = {}) {
  leadsLogger.info('Lead processado', {
    lead: leadData,
    status,
    ...details,
  });
}

module.exports = { logger, logLead };
