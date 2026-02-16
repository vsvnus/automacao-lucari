/**
 * PgService — Persistência de dados no PostgreSQL (substituindo Supabase)
 *
 * Responsabilidades:
 *   - Carregar configuração de clientes
 *   - Registrar leads processados (auditoria)
 *   - Salvar payload bruto do webhook (debug/histórico)
 *   - CRUD de clientes via API
 *   - Auth: users + sessions
 */

const { Pool } = require('pg');
const { logger } = require('./utils/logger');

/**
 * Retorna meia-noite de "hoje" no fuso de São Paulo (UTC-3) em formato ISO.
 */
function getTodayStartISO() {
    const now = new Date();
    const spHour = now.getUTCHours() - 3;
    const spDate = new Date(now);
    if (spHour < 0) spDate.setUTCDate(spDate.getUTCDate() - 1);
    return new Date(Date.UTC(
        spDate.getUTCFullYear(),
        spDate.getUTCMonth(),
        spDate.getUTCDate(),
        3, 0, 0, 0
    )).toISOString();
}

class PgService {
    constructor() {
        this.pool = null;
        this.initialized = false;
    }

    /**
     * Inicializa o pool de conexão com PostgreSQL.
     * Requer DATABASE_URL nas env vars.
     */
    initialize() {
        const databaseUrl = process.env.DATABASE_URL;

        if (!databaseUrl) {
            logger.warn('DATABASE_URL não configurada. Usando fallback local.');
            this.initialized = false;
            return false;
        }

        this.pool = new Pool({
            connectionString: databaseUrl,
            max: 20,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 5000,
        });

        this.pool.on('error', (err) => {
            logger.error('Erro inesperado no pool PostgreSQL', { error: err.message });
        });

        this.initialized = true;
        logger.info('PostgreSQL Service inicializado');
        return true;
    }

    isAvailable() {
        return this.initialized && this.pool !== null;
    }

    /**
     * Helper para executar queries com tratamento de erro padrão.
     */
    async query(text, params) {
        return this.pool.query(text, params);
    }

    // ============================================================
    // CLIENTS
    // ============================================================

    async getActiveClients() {
        if (!this.isAvailable()) return null;

        try {
            const { rows } = await this.query(
                'SELECT * FROM clients WHERE active = true ORDER BY name'
            );

            return rows.map(c => ({
                id: c.slug,
                _db_id: c.id,
                slug: c.slug,
                name: c.name,
                tintim_instance_id: c.tintim_instance_id,
                tintim_account_code: c.tintim_account_code || '',
                tintim_account_token: c.tintim_account_token || '',
                spreadsheet_id: c.spreadsheet_id,
                sheet_name: c.sheet_name || 'auto',
                active: c.active,
            }));
        } catch (error) {
            logger.error('Erro ao carregar clientes do PostgreSQL', { error: error.message });
            return null;
        }
    }

    async getAllClients() {
        if (!this.isAvailable()) return null;

        try {
            const { rows } = await this.query('SELECT * FROM clients ORDER BY name');

            return rows.map(c => ({
                id: c.slug,
                _db_id: c.id,
                slug: c.slug,
                name: c.name,
                tintim_instance_id: c.tintim_instance_id,
                tintim_account_code: c.tintim_account_code || '',
                tintim_account_token: c.tintim_account_token || '',
                spreadsheet_id: c.spreadsheet_id,
                sheet_name: c.sheet_name || 'auto',
                active: c.active,
                created_at: c.created_at,
                updated_at: c.updated_at,
            }));
        } catch (error) {
            logger.error('Erro ao listar todos os clientes', { error: error.message });
            return null;
        }
    }

    async addClient(clientData) {
        if (!this.isAvailable()) return null;

        try {
            const { rows } = await this.query(
                `INSERT INTO clients (slug, name, tintim_instance_id, tintim_account_code, tintim_account_token, spreadsheet_id, sheet_name, active)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                 RETURNING *`,
                [
                    clientData.id,
                    clientData.name,
                    clientData.tintim_instance_id,
                    clientData.tintim_account_code || '',
                    clientData.tintim_account_token || '',
                    clientData.spreadsheet_id,
                    clientData.sheet_name || 'auto',
                    clientData.active !== false,
                ]
            );

            logger.info(`Cliente adicionado no PostgreSQL: ${clientData.name}`);
            return rows[0];
        } catch (error) {
            logger.error('Erro ao adicionar cliente no PostgreSQL', { error: error.message });
            throw error;
        }
    }

    async updateClient(slug, updates) {
        if (!this.isAvailable()) return null;

        try {
            const { rows } = await this.query(
                `UPDATE clients SET
                    name = $1,
                    tintim_instance_id = $2,
                    tintim_account_code = $3,
                    tintim_account_token = $4,
                    spreadsheet_id = $5,
                    sheet_name = $6,
                    active = $7,
                    updated_at = NOW()
                 WHERE slug = $8
                 RETURNING *`,
                [
                    updates.name,
                    updates.tintim_instance_id,
                    updates.tintim_account_code || '',
                    updates.tintim_account_token || '',
                    updates.spreadsheet_id,
                    updates.sheet_name || 'auto',
                    updates.active !== false,
                    slug,
                ]
            );

            logger.info(`Cliente atualizado no PostgreSQL: ${slug}`);
            return rows[0];
        } catch (error) {
            logger.error('Erro ao atualizar cliente', { error: error.message });
            throw error;
        }
    }

    async deleteClient(slug) {
        if (!this.isAvailable()) return null;

        try {
            await this.query(
                'UPDATE clients SET active = false WHERE slug = $1',
                [slug]
            );

            logger.info(`Cliente desativado no PostgreSQL: ${slug}`);
            return true;
        } catch (error) {
            logger.error('Erro ao desativar cliente', { error: error.message });
            throw error;
        }
    }

    // ============================================================
    // LEADS LOG
    // ============================================================

    async logLead(clientId, leadInfo) {
        if (!this.isAvailable()) return;

        try {
            let clientUuid = null;
            if (clientId) {
                const { rows } = await this.query(
                    'SELECT id FROM clients WHERE slug = $1',
                    [clientId]
                );
                clientUuid = rows[0]?.id || null;
            }

            await this.query(
                `INSERT INTO leads_log (client_id, event_type, phone, lead_name, status, product, sale_amount, origin, sheet_name, sheet_row, processing_result, error_message)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
                [
                    clientUuid,
                    leadInfo.eventType || 'new_lead',
                    leadInfo.phone,
                    leadInfo.name,
                    leadInfo.status,
                    leadInfo.product,
                    leadInfo.saleAmount || null,
                    leadInfo.origin || 'WhatsApp',
                    leadInfo.sheetName,
                    leadInfo.sheetRow || null,
                    leadInfo.result || 'success',
                    leadInfo.error || null,
                ]
            );
        } catch (error) {
            logger.warn('Erro ao registrar lead no PostgreSQL', { error: error.message });
        }
    }

    async getRecentLeads(limit = 20) {
        if (!this.isAvailable()) return [];

        try {
            const { rows } = await this.query(
                `SELECT l.*, c.name as client_name
                 FROM leads_log l
                 LEFT JOIN clients c ON l.client_id = c.id
                 ORDER BY l.created_at DESC
                 LIMIT $1`,
                [limit]
            );

            return rows.map(log => ({
                id: log.id,
                client: log.client_name || 'Desconhecido',
                phone: log.phone,
                name: log.lead_name,
                status: log.status,
                event_type: log.event_type,
                timestamp: log.created_at,
                result: log.processing_result,
                error_message: log.error_message,
                origin: log.origin,
                sale_amount: log.sale_amount,
            }));
        } catch (error) {
            logger.error('Erro ao buscar logs recentes', { error: error.message });
            return [];
        }
    }

    async getLeadsByClient(clientSlug, limit = 50) {
        if (!this.isAvailable()) return [];

        try {
            const { rows: clientRows } = await this.query(
                'SELECT id, name FROM clients WHERE slug = $1',
                [clientSlug]
            );

            if (clientRows.length === 0) {
                logger.warn(`Cliente não encontrado para logs: ${clientSlug}`);
                return [];
            }

            const clientData = clientRows[0];

            const { rows } = await this.query(
                `SELECT * FROM leads_log
                 WHERE client_id = $1
                 ORDER BY created_at DESC
                 LIMIT $2`,
                [clientData.id, limit]
            );

            return {
                clientName: clientData.name,
                logs: rows.map(log => ({
                    id: log.id,
                    client: clientData.name,
                    phone: log.phone,
                    name: log.lead_name,
                    status: log.status,
                    event_type: log.event_type,
                    timestamp: log.created_at,
                    result: log.processing_result,
                    error_message: log.error_message,
                    origin: log.origin,
                    sale_amount: log.sale_amount,
                }))
            };
        } catch (error) {
            logger.error(`Erro ao buscar logs do cliente ${clientSlug}`, { error: error.message });
            return { clientName: 'Erro', logs: [] };
        }
    }

    async getTotalLeads() {
        if (!this.isAvailable()) return 0;

        try {
            const { rows } = await this.query(
                `SELECT COUNT(*) as count FROM leads_log
                 WHERE processing_result = 'success' AND event_type = 'new_lead'`
            );
            return parseInt(rows[0].count, 10);
        } catch {
            return 0;
        }
    }

    async checkDuplicateWebhook(phone, eventType, windowSeconds = 30) {
        if (!this.isAvailable()) return false;

        try {
            const windowStart = new Date(Date.now() - windowSeconds * 1000).toISOString();

            let sql = `SELECT COUNT(*) as count FROM webhook_events WHERE created_at >= $1`;
            const params = [windowStart];
            let paramIdx = 2;

            if (phone) {
                sql += ` AND phone = $${paramIdx}`;
                params.push(phone);
                paramIdx++;
            }
            if (eventType) {
                sql += ` AND event_type = $${paramIdx}`;
                params.push(eventType);
            }

            const { rows } = await this.query(sql, params);
            return parseInt(rows[0].count, 10) > 0;
        } catch (error) {
            logger.warn('Erro ao verificar duplicata de webhook', { error: error.message });
            return false;
        }
    }

    async getDashboardActivity(limit = 20, startDate, endDate) {
        if (!this.isAvailable()) return [];

        try {
            let sql = `SELECT l.*, c.name as client_name
                        FROM leads_log l
                        LEFT JOIN clients c ON l.client_id = c.id
                        WHERE 1=1`;
            const params = [];
            let paramIdx = 1;

            if (startDate) {
                sql += ` AND l.created_at >= $${paramIdx}`;
                params.push(startDate);
                paramIdx++;
            }
            if (endDate) {
                sql += ` AND l.created_at <= $${paramIdx}`;
                params.push(endDate);
                paramIdx++;
            }

            sql += ` ORDER BY l.created_at DESC LIMIT $${paramIdx}`;
            params.push(limit);

            const { rows } = await this.query(sql, params);

            return rows.map(log => ({
                id: log.id,
                timestamp: log.created_at,
                phone: log.phone,
                client: log.client_name || 'Desconhecido',
                name: log.lead_name || 'Sem nome',
                event_type: log.event_type,
                status: log.status,
                result: log.processing_result,
                error_message: log.error_message,
                sale_amount: log.sale_amount,
                product: log.product,
                sheet_name: log.sheet_name,
                origin: log.origin,
            }));
        } catch (error) {
            logger.error('Erro ao buscar atividade do dashboard', { error: error.message });
            return [];
        }
    }

    async getProcessedLeads(searchQuery, limit = 50) {
        if (!this.isAvailable()) return [];

        try {
            const cleanQuery = searchQuery ? searchQuery.replace(/[^\w\s-]/gi, '').trim() : '';

            if (!cleanQuery) {
                const { rows } = await this.query(
                    `SELECT l.*, c.name as client_name
                     FROM leads_log l
                     LEFT JOIN clients c ON l.client_id = c.id
                     ORDER BY l.created_at DESC
                     LIMIT $1`,
                    [limit]
                );
                return this._mapLeadLogs(rows);
            }

            // Check if it's a client slug
            const { rows: clientRows } = await this.query(
                'SELECT id FROM clients WHERE slug = $1',
                [cleanQuery]
            );

            let rows;
            if (clientRows.length > 0) {
                const result = await this.query(
                    `SELECT l.*, c.name as client_name
                     FROM leads_log l
                     LEFT JOIN clients c ON l.client_id = c.id
                     WHERE l.client_id = $1
                     ORDER BY l.created_at DESC
                     LIMIT $2`,
                    [clientRows[0].id, limit]
                );
                rows = result.rows;
            } else {
                const searchPattern = `%${cleanQuery}%`;
                const result = await this.query(
                    `SELECT l.*, c.name as client_name
                     FROM leads_log l
                     LEFT JOIN clients c ON l.client_id = c.id
                     WHERE l.phone ILIKE $1 OR l.lead_name ILIKE $1
                     ORDER BY l.created_at DESC
                     LIMIT $2`,
                    [searchPattern, limit]
                );
                rows = result.rows;
            }

            return this._mapLeadLogs(rows);
        } catch (error) {
            logger.error('Erro na busca de leads processados', { error: error.message });
            return [];
        }
    }

    _mapLeadLogs(rows) {
        return rows.map(log => ({
            id: log.id,
            timestamp: log.created_at,
            phone: log.phone,
            client: log.client_name || 'Desconhecido',
            name: log.lead_name || 'Sem nome',
            event_type: log.event_type,
            status: log.status,
            result: log.processing_result,
            error_message: log.error_message,
            sale_amount: log.sale_amount,
            product: log.product,
            sheet_name: log.sheet_name,
            origin: log.origin,
        }));
    }

    async getLeadsCountByClient(startDate, endDate) {
        if (!this.isAvailable()) return {};

        try {
            const from = startDate || getTodayStartISO();

            let sql = `SELECT c.slug, COUNT(*) as count
                        FROM leads_log l
                        JOIN clients c ON l.client_id = c.id
                        WHERE l.created_at >= $1 AND l.processing_result = 'success'`;
            const params = [from];
            let paramIdx = 2;

            if (endDate) {
                sql += ` AND l.created_at <= $${paramIdx}`;
                params.push(endDate);
            }

            sql += ` GROUP BY c.slug`;

            const { rows } = await this.query(sql, params);

            const counts = {};
            for (const row of rows) {
                counts[row.slug] = parseInt(row.count, 10);
            }
            return counts;
        } catch (error) {
            logger.error('Erro ao contar leads por cliente', { error: error.message });
            return {};
        }
    }

    async getLeadsCountByClientToday() {
        return this.getLeadsCountByClient();
    }

    async getLeadTimeline(phone) {
        if (!this.isAvailable()) return [];

        try {
            const cleanPhone = phone.replace(/[^\d+]/g, '');
            const pattern = `%${cleanPhone}%`;

            const [eventsResult, logsResult] = await Promise.all([
                this.query(
                    `SELECT w.*, c.name as client_name
                     FROM webhook_events w
                     LEFT JOIN clients c ON w.client_id = c.id
                     WHERE w.phone ILIKE $1
                     ORDER BY w.created_at ASC
                     LIMIT 100`,
                    [pattern]
                ),
                this.query(
                    `SELECT l.*, c.name as client_name
                     FROM leads_log l
                     LEFT JOIN clients c ON l.client_id = c.id
                     WHERE l.phone ILIKE $1
                     ORDER BY l.created_at ASC
                     LIMIT 100`,
                    [pattern]
                ),
            ]);

            const events = eventsResult.rows.map(e => ({
                id: `evt_${e.id}`,
                timestamp: e.created_at,
                type: 'webhook',
                phone: e.phone,
                client: e.client_name || 'Desconhecido',
                event_type: e.event_type,
                status: e.processing_result,
                payload: e.payload,
            }));

            const logs = logsResult.rows.map(l => ({
                id: `log_${l.id}`,
                timestamp: l.created_at,
                type: 'processing',
                phone: l.phone,
                client: l.client_name || 'Desconhecido',
                name: l.lead_name,
                event_type: l.event_type,
                status: l.status,
                result: l.processing_result,
                error_message: l.error_message,
                sale_amount: l.sale_amount,
                sheet_name: l.sheet_name,
            }));

            return [...events, ...logs].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        } catch (error) {
            logger.error('Erro ao buscar timeline do lead', { error: error.message });
            return [];
        }
    }

    // ============================================================
    // WEBHOOK EVENTS
    // ============================================================

    async logWebhookEvent(payload, clientSlug, processingResult) {
        if (!this.isAvailable()) return;

        try {
            let clientUuid = null;
            if (clientSlug) {
                const { rows } = await this.query(
                    'SELECT id FROM clients WHERE slug = $1',
                    [clientSlug]
                );
                clientUuid = rows[0]?.id || null;
            }

            await this.query(
                `INSERT INTO webhook_events (client_id, event_type, instance_id, phone, payload, processing_result)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [
                    clientUuid,
                    payload.event_type || null,
                    payload.instanceId || null,
                    payload.phone || null,
                    JSON.stringify(payload),
                    processingResult || 'success',
                ]
            );
        } catch (error) {
            logger.warn('Erro ao salvar evento webhook no PostgreSQL', { error: error.message });
        }
    }

    // ============================================================
    // SYSTEM SETTINGS
    // ============================================================

    async getSetting(key) {
        if (!this.isAvailable()) return null;

        try {
            const { rows } = await this.query(
                'SELECT value FROM system_settings WHERE key = $1',
                [key]
            );
            return rows[0]?.value || null;
        } catch {
            return null;
        }
    }

    async setSetting(key, value) {
        if (!this.isAvailable()) return false;

        try {
            await this.query(
                `INSERT INTO system_settings (key, value, updated_at)
                 VALUES ($1, $2, NOW())
                 ON CONFLICT (key)
                 DO UPDATE SET value = $2, updated_at = NOW()`,
                [key, value]
            );
            return true;
        } catch (error) {
            logger.error(`Erro ao salvar setting "${key}"`, { error: error.message });
            return false;
        }
    }

    // ============================================================
    // DASHBOARD & INVESTIGATION
    // ============================================================

    async getDashboardStats(startDate, endDate) {
        if (!this.isAvailable()) return null;

        try {
            const from = startDate || getTodayStartISO();

            const buildWhere = (extra = '') => {
                let where = `WHERE created_at >= $1`;
                const params = [from];
                let idx = 2;
                if (endDate) {
                    where += ` AND created_at <= $${idx}`;
                    params.push(endDate);
                    idx++;
                }
                if (extra) where += ` AND ${extra}`;
                return { where, params };
            };

            // 1. New Leads
            const nlq = buildWhere(`event_type = 'new_lead' AND processing_result = 'success'`);
            const { rows: nlRows } = await this.query(
                `SELECT COUNT(*) as count FROM leads_log ${nlq.where}`, nlq.params
            );

            // 2. Sales
            const sq = buildWhere(`event_type = 'status_update' AND processing_result = 'success' AND sale_amount IS NOT NULL`);
            const { rows: sRows } = await this.query(
                `SELECT COUNT(*) as count FROM leads_log ${sq.where}`, sq.params
            );

            // 3. Errors
            const eq = buildWhere(`processing_result = 'failed'`);
            const { rows: eRows } = await this.query(
                `SELECT COUNT(*) as count FROM leads_log ${eq.where}`, eq.params
            );

            // 4. Total processed
            const pq = buildWhere(`processing_result = 'success'`);
            const { rows: pRows } = await this.query(
                `SELECT COUNT(*) as count FROM leads_log ${pq.where}`, pq.params
            );

            const newLeads = parseInt(nlRows[0].count, 10);
            const sales = parseInt(sRows[0].count, 10);

            return {
                newLeads,
                sales,
                errors: parseInt(eRows[0].count, 10),
                processed: parseInt(pRows[0].count, 10),
                received: newLeads + sales,
            };
        } catch (error) {
            logger.error('Erro ao buscar stats do dashboard', { error: error.message });
            return null;
        }
    }

    async searchAllEvents(searchQuery, options = {}) {
        if (!this.isAvailable()) return [];

        const { source, from, to, limit: maxResults } = options;
        const resultLimit = parseInt(maxResults, 10) || 50;

        try {
            const cleanQuery = searchQuery ? searchQuery.replace(/[^\w\s-]/gi, '').trim() : '';
            let clientUuid = null;

            if (cleanQuery) {
                const { rows } = await this.query(
                    'SELECT id FROM clients WHERE slug = $1',
                    [cleanQuery]
                );
                if (rows.length > 0) clientUuid = rows[0].id;
            }

            // Build date filter clauses
            function buildDateFilter(alias, params) {
                let clause = '';
                if (from) {
                    params.push(from);
                    clause += ` AND ${alias}.created_at >= $${params.length}`;
                }
                if (to) {
                    params.push(to);
                    clause += ` AND ${alias}.created_at <= $${params.length}`;
                }
                return clause;
            }

            let eventsRows = [], logsRows = [];
            const includeEvents = source === 'all';
            const includeLogs = true; // always include logs

            if (!cleanQuery) {
                const promises = [];

                if (includeEvents) {
                    const eParams = [];
                    const eDateFilter = buildDateFilter('w', eParams);
                    eParams.push(resultLimit);
                    promises.push(this.query(
                        `SELECT w.*, c.name as client_name FROM webhook_events w
                         LEFT JOIN clients c ON w.client_id = c.id
                         WHERE 1=1${eDateFilter}
                         ORDER BY w.created_at DESC LIMIT $${eParams.length}`,
                        eParams
                    ));
                } else {
                    promises.push(Promise.resolve({ rows: [] }));
                }

                const lParams = [];
                const lDateFilter = buildDateFilter('l', lParams);
                lParams.push(resultLimit);
                promises.push(this.query(
                    `SELECT l.*, c.name as client_name FROM leads_log l
                     LEFT JOIN clients c ON l.client_id = c.id
                     WHERE 1=1${lDateFilter}
                     ORDER BY l.created_at DESC LIMIT $${lParams.length}`,
                    lParams
                ));

                const [er, lr] = await Promise.all(promises);
                eventsRows = er.rows;
                logsRows = lr.rows;
            } else if (clientUuid) {
                const promises = [];

                if (includeEvents) {
                    const eParams = [clientUuid];
                    const eDateFilter = buildDateFilter('w', eParams);
                    eParams.push(resultLimit);
                    promises.push(this.query(
                        `SELECT w.*, c.name as client_name FROM webhook_events w
                         LEFT JOIN clients c ON w.client_id = c.id
                         WHERE w.client_id = $1${eDateFilter}
                         ORDER BY w.created_at DESC LIMIT $${eParams.length}`,
                        eParams
                    ));
                } else {
                    promises.push(Promise.resolve({ rows: [] }));
                }

                const lParams = [clientUuid];
                const lDateFilter = buildDateFilter('l', lParams);
                lParams.push(resultLimit);
                promises.push(this.query(
                    `SELECT l.*, c.name as client_name FROM leads_log l
                     LEFT JOIN clients c ON l.client_id = c.id
                     WHERE l.client_id = $1${lDateFilter}
                     ORDER BY l.created_at DESC LIMIT $${lParams.length}`,
                    lParams
                ));

                const [er, lr] = await Promise.all(promises);
                eventsRows = er.rows;
                logsRows = lr.rows;
            } else {
                const pattern = `%${cleanQuery}%`;
                const promises = [];

                if (includeEvents) {
                    const eParams = [pattern, cleanQuery];
                    const eDateFilter = buildDateFilter('w', eParams);
                    eParams.push(resultLimit);
                    promises.push(this.query(
                        `SELECT w.*, c.name as client_name FROM webhook_events w
                         LEFT JOIN clients c ON w.client_id = c.id
                         WHERE (w.phone ILIKE $1 OR w.instance_id = $2)${eDateFilter}
                         ORDER BY w.created_at DESC LIMIT $${eParams.length}`,
                        eParams
                    ));
                } else {
                    promises.push(Promise.resolve({ rows: [] }));
                }

                const lParams = [pattern];
                const lDateFilter = buildDateFilter('l', lParams);
                lParams.push(resultLimit);
                promises.push(this.query(
                    `SELECT l.*, c.name as client_name FROM leads_log l
                     LEFT JOIN clients c ON l.client_id = c.id
                     WHERE (l.phone ILIKE $1 OR l.lead_name ILIKE $1)${lDateFilter}
                     ORDER BY l.created_at DESC LIMIT $${lParams.length}`,
                    lParams
                ));

                const [er, lr] = await Promise.all(promises);
                eventsRows = er.rows;
                logsRows = lr.rows;
            }

            const events = eventsRows.map(e => ({
                id: `evt_${e.id}`,
                timestamp: e.created_at,
                phone: e.phone,
                client: e.client_name || 'Desconhecido',
                name: e.payload?.name || e.payload?.chatName || e.payload?.pushName || 'Sem nome',
                status: e.processing_result === 'success' ? 'Recebido (Webhook)' : 'Erro (Webhook)',
                type: 'event',
                payload: e.payload,
            }));

            const logs = logsRows.map(l => ({
                id: `log_${l.id}`,
                timestamp: l.created_at,
                phone: l.phone,
                client: l.client_name || 'Desconhecido',
                name: l.lead_name || 'Sem nome',
                status: l.processing_result === 'success' ? `Processado: ${l.status}` : 'Erro Processamento',
                result: l.processing_result,
                event_type: l.event_type,
                sale_amount: l.sale_amount,
                origin: l.origin,
                error_message: l.error_message,
                type: 'log',
                payload: {
                    event: l.event_type,
                    product: l.product,
                    amount: l.sale_amount,
                    origin: l.origin,
                    sheet: l.sheet_name,
                    error: l.error_message,
                },
            }));

            return [...events, ...logs]
                .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
                .slice(0, resultLimit);
        } catch (error) {
            logger.error('Erro na busca de leads (investigação)', { error: error.message });
            return [];
        }
    }

    async getRecentErrors(limit = 50) {
        if (!this.isAvailable()) return [];

        try {
            const { rows } = await this.query(
                `SELECT w.*, c.name as client_name
                 FROM webhook_events w
                 LEFT JOIN clients c ON w.client_id = c.id
                 WHERE w.processing_result != 'success'
                 ORDER BY w.created_at DESC
                 LIMIT $1`,
                [limit]
            );

            return rows.map(event => ({
                id: event.id,
                timestamp: event.created_at,
                client: event.client_name || 'Desconhecido',
                phone: event.phone,
                error_type: event.processing_result,
                payload: event.payload,
            }));
        } catch (error) {
            logger.error('Erro ao buscar erros recentes', { error: error.message });
            return [];
        }
    }

    // ============================================================
    // AUTH (Users)
    // ============================================================

    async findUserByEmail(email) {
        if (!this.isAvailable()) return null;
        try {
            const { rows } = await this.query(
                'SELECT * FROM users WHERE email = $1',
                [email]
            );
            return rows[0] || null;
        } catch (error) {
            logger.error('Erro ao buscar user por email', { error: error.message });
            return null;
        }
    }

    async createUser(email, passwordHash, name) {
        if (!this.isAvailable()) return null;
        try {
            const { rows } = await this.query(
                `INSERT INTO users (email, password_hash, name)
                 VALUES ($1, $2, $3) RETURNING *`,
                [email, passwordHash, name]
            );
            return rows[0];
        } catch (error) {
            logger.error('Erro ao criar user', { error: error.message });
            throw error;
        }
    }

    // ============================================================
    // SCHEMA MIGRATION (auto-create tables on first run)
    // ============================================================

    async runMigrations() {
        if (!this.isAvailable()) return;

        try {
            const fs = require('fs');
            const path = require('path');
            const schemaPath = path.join(__dirname, '..', 'infra', 'schema-leads.sql');

            if (fs.existsSync(schemaPath)) {
                const schema = fs.readFileSync(schemaPath, 'utf-8');
                await this.query(schema);
                logger.info('Schema migrations executadas com sucesso');
            } else {
                logger.warn('Arquivo de schema não encontrado, pulando migrations');
            }
        } catch (error) {
            logger.error('Erro ao executar migrations', { error: error.message });
        }
    }
}

const pgService = new PgService();
module.exports = pgService;
