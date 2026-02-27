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
                webhook_source: c.webhook_source || 'tintim',
                kommo_pipeline_id: c.kommo_pipeline_id || '',
                kommo_account_id: c.kommo_account_id || '',
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
                webhook_source: c.webhook_source || 'tintim',
                kommo_pipeline_id: c.kommo_pipeline_id || '',
                kommo_account_id: c.kommo_account_id || '',
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
                `INSERT INTO clients (slug, name, tintim_instance_id, tintim_account_code, tintim_account_token, spreadsheet_id, sheet_name, active, webhook_source, kommo_pipeline_id, kommo_account_id)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
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
                    clientData.webhook_source || 'tintim',
                    clientData.kommo_pipeline_id || null,
                    clientData.kommo_account_id || null,
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
                    webhook_source = $8,
                    kommo_pipeline_id = $9,
                    kommo_account_id = $10,
                    updated_at = NOW()
                 WHERE slug = $11
                 RETURNING *`,
                [
                    updates.name,
                    updates.tintim_instance_id,
                    updates.tintim_account_code || '',
                    updates.tintim_account_token || '',
                    updates.spreadsheet_id,
                    updates.sheet_name || 'auto',
                    updates.active !== false,
                    updates.webhook_source || 'tintim',
                    updates.kommo_pipeline_id || null,
                    updates.kommo_account_id || null,
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
                // Resolver clientId: pode ser UUID direto ou slug
                const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId);
                if (isUuid) {
                    clientUuid = clientId;
                } else {
                    const { rows } = await this.query(
                        'SELECT id FROM clients WHERE slug = $1',
                        [clientId]
                    );
                    clientUuid = rows[0]?.id || null;
                }
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
                // Resolver clientSlug: pode ser UUID direto ou slug
                const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientSlug);
                if (isUuid) {
                    clientUuid = clientSlug;
                } else {
                    const { rows } = await this.query(
                        'SELECT id FROM clients WHERE slug = $1',
                        [clientSlug]
                    );
                    clientUuid = rows[0]?.id || null;
                }
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

    async createUser(email, passwordHash, name, role = 'admin') {
        if (!this.isAvailable()) return null;
        try {
            const { rows } = await this.query(
                `INSERT INTO users (email, password_hash, name, role)
                 VALUES ($1, $2, $3, $4) RETURNING id, email, name, role, created_at`,
                [email, passwordHash, name, role]
            );
            return rows[0];
        } catch (error) {
            logger.error('Erro ao criar user', { error: error.message });
            throw error;
        }
    }

    async listUsers() {
        if (!this.isAvailable()) return [];
        try {
            const { rows } = await this.query(
                'SELECT id, email, name, role, created_at, updated_at FROM users ORDER BY created_at ASC'
            );
            return rows;
        } catch (error) {
            logger.error('Erro ao listar users', { error: error.message });
            return [];
        }
    }

    async getUserById(id) {
        if (!this.isAvailable()) return null;
        try {
            const { rows } = await this.query(
                'SELECT id, email, name, role, created_at, updated_at FROM users WHERE id = $1',
                [id]
            );
            return rows[0] || null;
        } catch (error) {
            logger.error('Erro ao buscar user por id', { error: error.message });
            return null;
        }
    }

    async updateUser(id, { email, name, role, passwordHash }) {
        if (!this.isAvailable()) return null;
        try {
            const fields = [];
            const values = [];
            let idx = 1;

            if (email !== undefined) { fields.push(`email = $${idx++}`); values.push(email); }
            if (name !== undefined) { fields.push(`name = $${idx++}`); values.push(name); }
            if (role !== undefined) { fields.push(`role = $${idx++}`); values.push(role); }
            if (passwordHash) { fields.push(`password_hash = $${idx++}`); values.push(passwordHash); }

            if (fields.length === 0) return null;

            fields.push(`updated_at = NOW()`);
            values.push(id);

            const { rows } = await this.query(
                `UPDATE users SET ${fields.join(', ')} WHERE id = $${idx} RETURNING id, email, name, role, created_at, updated_at`,
                values
            );
            return rows[0] || null;
        } catch (error) {
            logger.error('Erro ao atualizar user', { error: error.message });
            throw error;
        }
    }

    async deleteUser(id) {
        if (!this.isAvailable()) return false;
        try {
            const { rowCount } = await this.query('DELETE FROM users WHERE id = $1', [id]);
            return rowCount > 0;
        } catch (error) {
            logger.error('Erro ao deletar user', { error: error.message });
            throw error;
        }
    }

    async countUsers() {
        if (!this.isAvailable()) return 0;
        try {
            const { rows } = await this.query('SELECT COUNT(*) as count FROM users');
            return parseInt(rows[0].count, 10);
        } catch {
            return 0;
        }
    }

    // ============================================================
    // ALERTAS
    // ============================================================

    async getClientsWithoutLeads(daysThreshold = 2) {
        if (!this.isAvailable()) return [];
        try {
            const result = await this.query(`
                SELECT c.id, c.name, c.slug, c.tintim_instance_id,
                       MAX(ll.created_at) as last_lead_at,
                       EXTRACT(DAY FROM NOW() - MAX(ll.created_at))::int as days_without_leads,
                       MAX(ll.created_at)::date as last_lead_date
                FROM clients c
                LEFT JOIN leads_log ll ON ll.client_id = c.id
                WHERE c.active = true
                GROUP BY c.id, c.name, c.slug, c.tintim_instance_id
                HAVING MAX(ll.created_at) < NOW() - INTERVAL '1 day' * $1
                   OR MAX(ll.created_at) IS NULL
                ORDER BY last_lead_at ASC NULLS FIRST
            `, [daysThreshold]);
            return result.rows;
        } catch (error) {
            logger.error("Erro ao buscar clientes sem leads", { error: error.message });
            return [];
        }
    }

    async getClientWebhookErrors(clientId, limit = 20) {
        if (!this.isAvailable()) return [];
        try {
            const result = await this.query(`
                SELECT we.id, we.event_type, we.created_at, we.processing_result,
                       we.payload
                FROM webhook_events we
                WHERE we.client_id = $1
                  AND we.processing_result != 'success'
                ORDER BY we.created_at DESC
                LIMIT $2
            `, [clientId, limit]);
            return result.rows;
        } catch (error) {
            logger.error("Erro ao buscar erros de webhook", { error: error.message });
            return [];
        }
    }

    async getWebhookById(webhookId) {
        if (!this.isAvailable()) return null;
        try {
            const result = await this.query(`
                SELECT * FROM webhook_events WHERE id = $1
            `, [webhookId]);
            return result.rows[0] || null;
        } catch (error) {
            logger.error("Erro ao buscar webhook", { error: error.message });
            return null;
        }
    }


    // ============================================================
    // LEAD TRAIL (rastreamento passo-a-passo)
    // ============================================================

    async addTrailStep(traceId, stepOrder, stepName, status, detail, metadata, durationMs) {
        if (!this.isAvailable()) return;
        try {
            await this.query(
                `INSERT INTO lead_trail (trace_id, step_order, step_name, status, detail, metadata, duration_ms)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [traceId, stepOrder, stepName, status, detail || null, metadata ? JSON.stringify(metadata) : null, durationMs || null]
            );
        } catch (error) {
            logger.warn("Erro ao registrar trail step", { error: error.message, traceId, stepName });
        }
    }

    async getTrailByTrace(traceId) {
        if (!this.isAvailable()) return [];
        try {
            const { rows } = await this.query(
                `SELECT * FROM lead_trail WHERE trace_id = $1 ORDER BY step_order ASC`,
                [traceId]
            );
            return rows;
        } catch (error) {
            logger.error("Erro ao buscar trail", { error: error.message });
            return [];
        }
    }

    async getTrailErrors(limit = 50) {
        if (!this.isAvailable()) return [];
        try {
            const { rows } = await this.query(`
                SELECT t.trace_id, t.step_name, t.detail, t.metadata, t.created_at,
                       (SELECT lt2.detail FROM lead_trail lt2 WHERE lt2.trace_id = t.trace_id AND lt2.step_name = 'webhook_received' LIMIT 1) as webhook_detail,
                       (SELECT lt3.metadata FROM lead_trail lt3 WHERE lt3.trace_id = t.trace_id AND lt3.step_name = 'webhook_received' LIMIT 1) as webhook_metadata
                FROM lead_trail t
                WHERE t.status = 'error'
                ORDER BY t.created_at DESC
                LIMIT $1
            `, [limit]);
            return rows;
        } catch (error) {
            logger.error("Erro ao buscar trail errors", { error: error.message });
            return [];
        }
    }

    async getTrailErrorStats() {
        if (!this.isAvailable()) return { today: 0, lastHour: 0, totalToday: 0, successToday: 0 };
        try {
            const nowSP = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
            const todayStart = new Date(nowSP);
            todayStart.setHours(0, 0, 0, 0);
            const todayISO = new Date(todayStart.getTime() + 3 * 60 * 60 * 1000).toISOString();
            const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

            const [errToday, errHour, totalToday, successToday] = await Promise.all([
                this.query(`SELECT COUNT(DISTINCT trace_id) as count FROM lead_trail WHERE status = 'error' AND created_at >= $1`, [todayISO]),
                this.query(`SELECT COUNT(DISTINCT trace_id) as count FROM lead_trail WHERE status = 'error' AND created_at >= $1`, [oneHourAgo]),
                this.query(`SELECT COUNT(DISTINCT trace_id) as count FROM lead_trail WHERE created_at >= $1`, [todayISO]),
                this.query(`SELECT COUNT(DISTINCT trace_id) as count FROM lead_trail WHERE created_at >= $1 AND trace_id NOT IN (SELECT DISTINCT trace_id FROM lead_trail WHERE status = 'error' AND created_at >= $1)`, [todayISO]),
            ]);

            return {
                today: parseInt(errToday.rows[0].count, 10),
                lastHour: parseInt(errHour.rows[0].count, 10),
                totalToday: parseInt(totalToday.rows[0].count, 10),
                successToday: parseInt(successToday.rows[0].count, 10),
            };
        } catch (error) {
            logger.error("Erro ao buscar stats de trail", { error: error.message });
            return { today: 0, lastHour: 0, totalToday: 0, successToday: 0 };
        }
    }

    async getPayloadByTraceId(traceId) {
        if (!this.isAvailable()) return null;
        try {
            const { rows } = await this.query(
                `SELECT metadata FROM lead_trail WHERE trace_id = $1 AND step_name = 'webhook_received' LIMIT 1`,
                [traceId]
            );
            return rows[0]?.metadata?.payload || null;
        } catch (error) {
            logger.error("Erro ao buscar payload por trace_id", { error: error.message });
            return null;
        }
    }


// ============================================================
    // KEYWORDS (Google Ads keyword tracking)
    // ============================================================

    async saveKeywordConversion(data) {
        if (!this.isAvailable()) return null;
        try {
            const { rows } = await this.query(
                `INSERT INTO keyword_conversions
                 (client_id, keyword, campaign, utm_source, utm_medium, utm_content, gclid,
                  landing_page, device_type, location_state, lead_phone, lead_name, lead_status, product,
                  sale_amount, converted)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
                 RETURNING id`,
                [data.clientId, data.keyword, data.campaign, data.utmSource, data.utmMedium,
                 data.utmContent, data.gclid, data.landingPage, data.deviceType, data.locationState,
                 data.leadPhone, data.leadName, data.leadStatus, data.product,
                 data.saleAmount || 0, data.converted || false]
            );
            return rows[0]?.id || null;
        } catch (error) {
            logger.error("Erro ao salvar keyword conversion", { error: error.message });
            return null;
        }
    }

    async upsertKeywordConversion(phone, data) {
        if (!this.isAvailable()) return;
        try {
            const { rowCount } = await this.query(
                `UPDATE keyword_conversions
                 SET sale_amount = $1, converted = true, lead_status = COALESCE($2, lead_status), converted_at = NOW()
                 WHERE id = (SELECT id FROM keyword_conversions WHERE lead_phone = $3 ORDER BY created_at DESC LIMIT 1)`,
                [data.saleAmount || 0, data.leadStatus || null, phone]
            );
            if (rowCount === 0) {
                logger.info("Nenhum keyword_conversion encontrado para telefone: " + phone + " (lead pode nao ser Google Ads)");
            }
        } catch (error) {
            logger.error("Erro ao upsert keyword conversion", { error: error.message });
        }
    }

    async getKeywordsOverview(clientId, startDate, endDate) {
        if (!this.isAvailable()) return [];
        try {
            let where = "WHERE 1=1";
            const params = [];
            let idx = 1;
            if (clientId) { where += ` AND client_id = $${idx}`; params.push(clientId); idx++; }
            if (startDate) { where += ` AND created_at >= $${idx}`; params.push(startDate); idx++; }
            if (endDate) { where += ` AND created_at <= $${idx}`; params.push(endDate); idx++; }

            const { rows } = await this.query(`
                SELECT keyword, campaign,
                       COUNT(*) as leads,
                       SUM(CASE WHEN converted THEN 1 ELSE 0 END) as conversions,
                       ROUND(SUM(CASE WHEN converted THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*),0) * 100, 1) as rate,
                       SUM(sale_amount) as total_value,
                       MAX(created_at) as last_date
                FROM keyword_conversions
                ${where}
                GROUP BY keyword, campaign
                ORDER BY leads DESC
            `, params);
            return rows;
        } catch (error) {
            logger.error("Erro ao buscar keywords overview", { error: error.message });
            return [];
        }
    }

    async getKeywordsStats(clientId, startDate, endDate) {
        if (!this.isAvailable()) return { uniqueKeywords: 0, totalLeads: 0, topKeyword: null, conversionRate: 0 };
        try {
            let where = "WHERE 1=1";
            const params = [];
            let idx = 1;
            if (clientId) { where += ` AND client_id = $${idx}`; params.push(clientId); idx++; }
            if (startDate) { where += ` AND created_at >= $${idx}`; params.push(startDate); idx++; }
            if (endDate) { where += ` AND created_at <= $${idx}`; params.push(endDate); idx++; }

            const { rows } = await this.query(`
                SELECT
                    COUNT(DISTINCT keyword) as unique_keywords,
                    COUNT(*) as total_leads,
                    SUM(CASE WHEN converted THEN 1 ELSE 0 END) as total_conversions,
                    ROUND(SUM(CASE WHEN converted THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*),0) * 100, 1) as conversion_rate,
                    SUM(sale_amount) as total_value
                FROM keyword_conversions
                ${where}
            `, params);

            // Top keyword
            const { rows: topRows } = await this.query(`
                SELECT keyword, COUNT(*) as cnt
                FROM keyword_conversions
                ${where} AND keyword IS NOT NULL AND keyword != ''
                GROUP BY keyword ORDER BY cnt DESC LIMIT 1
            `, params);

            const stats = rows[0] || {};
            return {
                uniqueKeywords: parseInt(stats.unique_keywords || 0, 10),
                totalLeads: parseInt(stats.total_leads || 0, 10),
                totalConversions: parseInt(stats.total_conversions || 0, 10),
                conversionRate: parseFloat(stats.conversion_rate || 0),
                totalValue: parseFloat(stats.total_value || 0),
                topKeyword: topRows[0]?.keyword || null,
            };
        } catch (error) {
            logger.error("Erro ao buscar keywords stats", { error: error.message });
            return { uniqueKeywords: 0, totalLeads: 0, topKeyword: null, conversionRate: 0 };
        }
    }

    async getKeywordsTrend(clientId, startDate, endDate) {
        if (!this.isAvailable()) return [];
        try {
            let where = "WHERE 1=1";
            const params = [];
            let idx = 1;
            if (clientId) { where += ` AND client_id = $${idx}`; params.push(clientId); idx++; }
            if (startDate) { where += ` AND created_at >= $${idx}`; params.push(startDate); idx++; }
            if (endDate) { where += ` AND created_at <= $${idx}`; params.push(endDate); idx++; }

            const { rows } = await this.query(`
                SELECT DATE(created_at AT TIME ZONE 'America/Sao_Paulo') as day,
                       COUNT(*) as leads,
                       SUM(CASE WHEN converted THEN 1 ELSE 0 END) as conversions
                FROM keyword_conversions
                ${where}
                GROUP BY day
                ORDER BY day ASC
            `, params);
            return rows;
        } catch (error) {
            logger.error("Erro ao buscar keywords trend", { error: error.message });
            return [];
        }
    }

    async getKeywordDetail(keyword, clientId, startDate, endDate) {
        if (!this.isAvailable()) return [];
        try {
            let where = "WHERE keyword = $1";
            const params = [keyword];
            let idx = 2;
            if (clientId) { where += ` AND client_id = $${idx}`; params.push(clientId); idx++; }
            if (startDate) { where += ` AND created_at >= $${idx}`; params.push(startDate); idx++; }
            if (endDate) { where += ` AND created_at <= $${idx}`; params.push(endDate); idx++; }

            const { rows } = await this.query(`
                SELECT kc.*, c.name as client_name
                FROM keyword_conversions kc
                LEFT JOIN clients c ON c.id = kc.client_id
                ${where}
                ORDER BY kc.created_at DESC
            `, params);
            return rows;
        } catch (error) {
            logger.error("Erro ao buscar keyword detail", { error: error.message });
            return [];
        }
    }

    async getCampaignsOverview(clientId, startDate, endDate) {
        if (!this.isAvailable()) return [];
        try {
            let where = "WHERE 1=1";
            const params = [];
            let idx = 1;
            if (clientId) { where += ` AND client_id = $${idx}`; params.push(clientId); idx++; }
            if (startDate) { where += ` AND created_at >= $${idx}`; params.push(startDate); idx++; }
            if (endDate) { where += ` AND created_at <= $${idx}`; params.push(endDate); idx++; }

            const { rows } = await this.query(`
                SELECT campaign,
                       COUNT(*) as leads,
                       COUNT(DISTINCT keyword) as keywords,
                       SUM(CASE WHEN converted THEN 1 ELSE 0 END) as conversions,
                       SUM(sale_amount) as total_value
                FROM keyword_conversions
                ${where}
                GROUP BY campaign
                ORDER BY leads DESC
            `, params);
            return rows;
        } catch (error) {
            logger.error("Erro ao buscar campaigns overview", { error: error.message });
            return [];
        }
    }

    async getKeywordsBreakdown(clientId, startDate, endDate) {
        if (!this.isAvailable()) return { devices: [], locations: [] };
        try {
            let where = "WHERE 1=1";
            const params = [];
            let idx = 1;
            if (clientId) { where += ` AND client_id = $${idx}`; params.push(clientId); idx++; }
            if (startDate) { where += ` AND created_at >= $${idx}`; params.push(startDate); idx++; }
            if (endDate) { where += ` AND created_at <= $${idx}`; params.push(endDate); idx++; }

            const { rows: devices } = await this.query(`
                SELECT COALESCE(device_type, 'Desconhecido') as device_type, COUNT(*) as count
                FROM keyword_conversions
                ${where}
                GROUP BY device_type
                ORDER BY count DESC
            `, params);

            const { rows: locations } = await this.query(`
                SELECT COALESCE(location_state, 'Desconhecido') as location_state, COUNT(*) as count
                FROM keyword_conversions
                ${where}
                GROUP BY location_state
                ORDER BY count DESC
            `, params);

            return { devices, locations };
        } catch (error) {
            logger.error("Erro ao buscar keywords breakdown", { error: error.message });
            return { devices: [], locations: [] };
        }
    }

    async backfillKeywords() {
        if (!this.isAvailable()) return 0;
        try {
            const { rowCount } = await this.query(`
                INSERT INTO keyword_conversions (client_id, keyword, campaign, utm_source, utm_medium, utm_content,
                    gclid, landing_page, device_type, location_state, lead_phone, lead_name, lead_status, product, created_at)
                SELECT
                    w.client_id,
                    COALESCE(w.payload->>'utm_term', w.payload->'visit'->'params'->>'utm_term'),
                    COALESCE(w.payload->>'utm_campaign', w.payload->'visit'->'params'->>'utm_campaign'),
                    COALESCE(w.payload->>'utm_source', 'google'),
                    COALESCE(w.payload->>'utm_medium', 'cpc'),
                    w.payload->>'utm_content',
                    w.payload->'visit'->'params'->>'gclid',
                    w.payload->'visit'->>'name',
                    w.payload->'visit'->'meta'->'http_user_agent'->'device'->>'type',
                    w.payload->'location'->>'state',
                    w.payload->>'phone',
                    COALESCE(w.payload->>'chatName', w.payload->>'name', ''),
                    'Lead Gerado',
                    '',
                    w.created_at
                FROM webhook_events w
                WHERE ((w.payload->>'utm_term' IS NOT NULL AND length(w.payload->>'utm_term') > 0)
                   OR (w.payload->'visit'->'params'->>'utm_term' IS NOT NULL AND length(w.payload->'visit'->'params'->>'utm_term') > 0))
                AND COALESCE(w.payload->>'utm_source', '') NOT IN ('fb', 'facebook', 'instagram', 'ig')
                AND COALESCE(LOWER(w.payload->>'source'), '') NOT LIKE '%meta%'
                AND COALESCE(LOWER(w.payload->>'source'), '') NOT LIKE '%facebook%'
                AND NOT EXISTS (
                    SELECT 1 FROM keyword_conversions kc
                    WHERE kc.lead_phone = w.payload->>'phone'
                      AND kc.created_at = w.created_at
                )
            `);
            logger.info(`Backfill keywords: ${rowCount} registros migrados`);
            return rowCount;
        } catch (error) {
            logger.error("Erro ao executar backfill de keywords", { error: error.message });
            return 0;
        }
    }

    async getOverviewStats({ from, to } = {}) {
        if (!this.isAvailable()) return null;

        try {
            const todayStart = getTodayStartISO();
            const yesterdayStart = new Date(new Date(todayStart).getTime() - 24 * 60 * 60 * 1000).toISOString();

            // Period bounds: use caller-supplied dates or default to 7d
            const fromTs = from || new Date(Date.now() - 7 * 86400000).toISOString();
            const toTs = to || null;

            const [clientSummary, funnel, origins, healthStats, todayVsYesterday, keywordsSummary] = await Promise.all([
                // Per-client summary — respects selected period, includes main product
                this.query(`
                    SELECT c.name, c.slug,
                        mode() WITHIN GROUP (ORDER BY l.product)
                            FILTER (WHERE l.product IS NOT NULL AND l.product != '') AS main_product,
                        count(l.id) FILTER (
                            WHERE l.processing_result = 'success' AND l.event_type = 'new_lead'
                        ) AS total_leads,
                        count(l.id) FILTER (
                            WHERE l.sale_amount > 0
                               OR (l.processing_result = 'success' AND l.status ILIKE ANY(
                                    ARRAY['%comprou%','%fechou%','%vendido%','%ganhou%','%contrato%']
                               ))
                        ) AS sales,
                        COALESCE(sum(l.sale_amount) FILTER (WHERE l.sale_amount > 0), 0) AS revenue,
                        max(l.created_at) FILTER (WHERE l.processing_result = 'success') AS last_lead_at
                    FROM clients c
                    LEFT JOIN leads_log l ON l.client_id = c.id
                        AND l.created_at >= $1
                        AND ($2::timestamptz IS NULL OR l.created_at < $2)
                    WHERE c.active = true
                    GROUP BY c.id, c.name, c.slug
                    ORDER BY total_leads DESC
                `, [fromTs, toTs]),
                // Conversion funnel — respects period, includes product context
                this.query(`
                    SELECT
                        count(*) FILTER (WHERE processing_result = 'success' AND event_type = 'new_lead') AS leads_gerados,
                        count(*) FILTER (WHERE status = 'Lead Conectado') AS leads_conectados,
                        count(*) FILTER (WHERE status ILIKE '%atendimento%') AS em_atendimento,
                        count(*) FILTER (WHERE status ILIKE '%proposta%') AS proposta,
                        count(*) FILTER (WHERE sale_amount > 0 OR status ILIKE ANY(ARRAY['%comprou%','%fechou%','%vendido%','%ganhou%','%contrato%'])) AS vendas,
                        count(*) FILTER (WHERE status ILIKE '%desqualificado%') AS desqualificados,
                        json_agg(DISTINCT product) FILTER (WHERE product IS NOT NULL AND product != '') AS products_in_funnel,
                        COALESCE(sum(sale_amount) FILTER (WHERE sale_amount > 0), 0) AS receita_total
                    FROM leads_log
                    WHERE created_at >= $1 AND ($2::timestamptz IS NULL OR created_at < $2)
                      AND processing_result = 'success'
                `, [fromTs, toTs]),
                // Origin breakdown — sales attributed to original lead origin (not status-update channel)
                this.query(`
                    WITH period_events AS (
                        SELECT phone, origin, sale_amount, event_type, processing_result, status
                        FROM leads_log
                        WHERE created_at >= $1 AND ($2::timestamptz IS NULL OR created_at < $2)
                    ),
                    first_origin_per_phone AS (
                        SELECT DISTINCT ON (payload->>'phone')
                               payload->>'phone' AS phone,
                               CASE
                                   WHEN (payload->>'source') ILIKE '%google%'
                                     OR (payload->>'utm_source') ILIKE '%google%'
                                     OR (payload->>'gclid') IS NOT NULL
                                   THEN 'Google Ads'
                                   WHEN (payload->>'source') ILIKE '%meta%'
                                     OR (payload->>'source') ILIKE '%facebook%'
                                     OR (payload->>'source') ILIKE '%instagram%'
                                     OR (payload->>'utm_source') ILIKE '%facebook%'
                                     OR (payload->>'utm_source') ILIKE '%meta%'
                                     OR (payload->>'fbclid') IS NOT NULL
                                   THEN 'Meta Ads'
                                   ELSE NULL
                               END AS lead_origin
                        FROM webhook_events
                        WHERE payload->>'phone' IS NOT NULL
                        ORDER BY payload->>'phone', created_at ASC
                    ),
                    leads_by_origin AS (
                        SELECT COALESCE(pe.origin, 'WhatsApp') AS origin,
                               count(*) FILTER (WHERE pe.event_type = 'new_lead' AND pe.processing_result = 'success') AS total
                        FROM period_events pe
                        GROUP BY COALESCE(pe.origin, 'WhatsApp')
                    ),
                    sales_by_true_origin AS (
                        SELECT COALESCE(fo.lead_origin, pe.origin, 'WhatsApp') AS origin,
                               count(*) AS sales,
                               COALESCE(sum(pe.sale_amount) FILTER (WHERE pe.sale_amount > 0), 0) AS revenue
                        FROM period_events pe
                        LEFT JOIN first_origin_per_phone fo ON fo.phone = pe.phone
                        WHERE pe.sale_amount > 0
                           OR pe.status ILIKE ANY(ARRAY['%comprou%','%fechou%','%vendido%','%ganhou%','%contrato%'])
                        GROUP BY COALESCE(fo.lead_origin, pe.origin, 'WhatsApp')
                    )
                    SELECT COALESCE(lo.origin, so.origin) AS origin,
                           COALESCE(lo.total, 0) AS total,
                           COALESCE(so.sales, 0) AS sales,
                           COALESCE(so.revenue, 0) AS revenue
                    FROM leads_by_origin lo
                    FULL OUTER JOIN sales_by_true_origin so ON so.origin = lo.origin
                    ORDER BY COALESCE(lo.total, 0) DESC
                `, [fromTs, toTs]),
                // Health stats (always fixed windows — not period-filtered)
                this.query(`
                    SELECT
                        count(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours') AS total_24h,
                        count(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours' AND processing_result IN ('failed', 'invalid')) AS errors_24h,
                        count(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days') AS total_30d,
                        count(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days' AND processing_result IN ('failed', 'invalid')) AS errors_30d,
                        max(created_at) FILTER (WHERE processing_result IN ('failed', 'invalid')) AS last_error_at
                    FROM webhook_events
                `),
                // Today vs Yesterday comparison (always fixed to today)
                this.query(`
                    SELECT
                        count(*) FILTER (WHERE created_at >= $1
                            AND processing_result = 'success' AND event_type = 'new_lead') AS today,
                        count(*) FILTER (WHERE created_at >= $2
                            AND created_at < $1
                            AND processing_result = 'success' AND event_type = 'new_lead') AS yesterday
                    FROM leads_log
                `, [todayStart, yesterdayStart]),
                // Google Ads keywords summary — respects period
                this.query(`
                    WITH all_kw AS (
                        SELECT keyword,
                               count(*) AS kw_count,
                               bool_or(converted) AS kw_converted,
                               COALESCE(sum(sale_amount) FILTER (WHERE converted AND sale_amount > 0), 0) AS sale_amount
                        FROM keyword_conversions
                        WHERE created_at >= $1 AND ($2::timestamptz IS NULL OR created_at < $2)
                        GROUP BY keyword
                    )
                    SELECT
                        (SELECT count(*) FROM all_kw) AS unique_keywords,
                        (SELECT COALESCE(sum(kw_count), 0) FROM all_kw) AS total_kw_leads,
                        (SELECT count(*) FROM all_kw WHERE kw_converted) AS kw_conversions,
                        (SELECT COALESCE(sum(sale_amount), 0) FROM all_kw WHERE kw_converted) AS kw_revenue,
                        (
                            SELECT json_agg(
                                json_build_object('keyword', keyword, 'leads', kw_count, 'converted', kw_converted)
                                ORDER BY kw_count DESC
                            )
                            FROM (SELECT * FROM all_kw ORDER BY kw_count DESC LIMIT 5) top5
                        ) AS top_keywords
                `, [fromTs, toTs])
            ]);

            return {
                clients: clientSummary.rows.map(r => ({
                    name: r.name,
                    slug: r.slug,
                    mainProduct: r.main_product || null,
                    totalLeads: parseInt(r.total_leads),
                    sales: parseInt(r.sales),
                    revenue: parseFloat(r.revenue),
                    lastLeadAt: r.last_lead_at,
                })),
                funnel: {
                    leadsGerados: parseInt(funnel.rows[0]?.leads_gerados || 0),
                    leadsConectados: parseInt(funnel.rows[0]?.leads_conectados || 0),
                    emAtendimento: parseInt(funnel.rows[0]?.em_atendimento || 0),
                    proposta: parseInt(funnel.rows[0]?.proposta || 0),
                    vendas: parseInt(funnel.rows[0]?.vendas || 0),
                    desqualificados: parseInt(funnel.rows[0]?.desqualificados || 0),
                    productsInFunnel: (funnel.rows[0]?.products_in_funnel || []).filter(Boolean),
                    receitaTotal: parseFloat(funnel.rows[0]?.receita_total || 0),
                },
                origins: origins.rows.map(r => ({
                    origin: r.origin,
                    total: parseInt(r.total),
                    sales: parseInt(r.sales),
                    revenue: parseFloat(r.revenue),
                })),
                health: {
                    total24h: parseInt(healthStats.rows[0]?.total_24h || 0),
                    errors24h: parseInt(healthStats.rows[0]?.errors_24h || 0),
                    total30d: parseInt(healthStats.rows[0]?.total_30d || 0),
                    errors30d: parseInt(healthStats.rows[0]?.errors_30d || 0),
                    lastErrorAt: healthStats.rows[0]?.last_error_at,
                    successRate: healthStats.rows[0]?.total_30d > 0
                        ? ((1 - (parseInt(healthStats.rows[0]?.errors_30d || 0) / parseInt(healthStats.rows[0]?.total_30d))) * 100).toFixed(1)
                        : '100.0',
                },
                comparison: {
                    today: parseInt(todayVsYesterday.rows[0]?.today || 0),
                    yesterday: parseInt(todayVsYesterday.rows[0]?.yesterday || 0),
                },
                keywords: {
                    uniqueKeywords: parseInt(keywordsSummary.rows[0]?.unique_keywords || 0),
                    totalLeads: parseInt(keywordsSummary.rows[0]?.total_kw_leads || 0),
                    conversions: parseInt(keywordsSummary.rows[0]?.kw_conversions || 0),
                    revenue: parseFloat(keywordsSummary.rows[0]?.kw_revenue || 0),
                    topKeywords: keywordsSummary.rows[0]?.top_keywords || [],
                },
            };
        } catch (error) {
            logger.error('Erro ao buscar overview stats', { error: error.message });
            return null;
        }
    }

    async getErrorsSummary() {
        if (!this.isAvailable()) return null;

        try {
            const [errorsByType, recentErrors] = await Promise.all([
                this.query(`
                    SELECT
                        COALESCE(l.error_message, l.processing_result) AS error_type,
                        count(*) AS count,
                        max(l.created_at) AS last_occurrence,
                        array_agg(DISTINCT c.name) FILTER (WHERE c.name IS NOT NULL) AS affected_clients
                    FROM leads_log l
                    LEFT JOIN clients c ON l.client_id = c.id
                    WHERE l.processing_result IN ('failed', 'error')
                    GROUP BY COALESCE(l.error_message, l.processing_result)
                    ORDER BY last_occurrence DESC
                `),
                this.query(`
                    SELECT l.*, c.name AS client_name
                    FROM leads_log l
                    LEFT JOIN clients c ON l.client_id = c.id
                    WHERE l.processing_result IN ('failed', 'error')
                    ORDER BY l.created_at DESC
                    LIMIT 20
                `)
            ]);

            return {
                errorsByType: errorsByType.rows.map(r => ({
                    errorType: r.error_type,
                    count: parseInt(r.count),
                    lastOccurrence: r.last_occurrence,
                    affectedClients: r.affected_clients || [],
                })),
                recentErrors: recentErrors.rows.map(l => ({
                    id: l.id,
                    timestamp: l.created_at,
                    phone: l.phone,
                    client: l.client_name || 'Desconhecido',
                    name: l.lead_name || 'Sem nome',
                    status: l.status,
                    errorMessage: l.error_message,
                    origin: l.origin,
                    product: l.product,
                })),
            };
        } catch (error) {
            logger.error('Erro ao buscar resumo de erros', { error: error.message });
            return null;
        }
    }

    // SCHEMA MIGRATION (auto-create tables on first run)
    // ============================================================

    async runMigrations() {
        if (!this.isAvailable()) return;

        try {
            const fs = require('fs');
            const path = require('path');

            // Step 1: Run base schema (idempotent CREATE IF NOT EXISTS)
            const schemaPath = path.join(__dirname, '..', 'infra', 'schema-leads.sql');
            if (fs.existsSync(schemaPath)) {
                const schema = fs.readFileSync(schemaPath, 'utf-8');
                await this.query(schema);
                logger.info('Base schema applied');
            }

            // Step 2: Run versioned migrations from migrations/ directory
            const migrationsDir = path.join(__dirname, '..', 'migrations');
            if (!fs.existsSync(migrationsDir)) {
                logger.info('No migrations directory found, skipping versioned migrations');
                return;
            }

            // Create migrations tracking table
            await this.query(`
                CREATE TABLE IF NOT EXISTS pgmigrations (
                    id SERIAL PRIMARY KEY,
                    name VARCHAR(255) UNIQUE NOT NULL,
                    run_on TIMESTAMPTZ DEFAULT NOW()
                )
            `);

            // Get already-run migrations
            const { rows: executed } = await this.query('SELECT name FROM pgmigrations ORDER BY id');
            const executedSet = new Set(executed.map(r => r.name));

            // Get migration files sorted
            const files = fs.readdirSync(migrationsDir)
                .filter(f => f.endsWith('.sql'))
                .sort();

            let applied = 0;
            for (const file of files) {
                if (executedSet.has(file)) continue;

                const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
                await this.query('BEGIN');
                try {
                    await this.query(sql);
                    await this.query('INSERT INTO pgmigrations (name) VALUES ($1)', [file]);
                    await this.query('COMMIT');
                    applied++;
                    logger.info(`Migration applied: ${file}`);
                } catch (err) {
                    await this.query('ROLLBACK');
                    logger.error(`Migration failed: ${file}`, { error: err.message });
                    throw err;
                }
            }

            if (applied > 0) {
                logger.info(`${applied} migration(s) applied successfully`);
            } else {
                logger.info('All migrations up to date');
            }
        } catch (error) {
            logger.error('Erro ao executar migrations', { error: error.message });
        }
    }
}

const pgService = new PgService();
module.exports = pgService;
