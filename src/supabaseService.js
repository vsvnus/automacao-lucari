/**
 * SupabaseService — Persistência de dados no Supabase (PostgreSQL)
 * 
 * Responsabilidades:
 *   - Carregar configuração de clientes (substitui clients.json)
 *   - Registrar leads processados (auditoria)
 *   - Salvar payload bruto do webhook (debug/histórico)
 *   - CRUD de clientes via API
 */

const { createClient } = require('@supabase/supabase-js');
const { logger } = require('./utils/logger');

class SupabaseService {
    constructor() {
        this.client = null;
        this.initialized = false;
    }

    /**
     * Inicializa a conexão com o Supabase.
     * Requer SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY nas env vars.
     */
    initialize() {
        const url = process.env.SUPABASE_URL;
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (!url || !key) {
            logger.warn('⚠️ Supabase não configurado (SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY ausente). Usando fallback local.');
            this.initialized = false;
            return false;
        }

        this.client = createClient(url, key, {
            auth: { persistSession: false },
        });

        this.initialized = true;
        logger.info('✅ Supabase Service inicializado');
        return true;
    }

    isAvailable() {
        return this.initialized && this.client !== null;
    }

    // ============================================================
    // CLIENTS (substitui clients.json)
    // ============================================================

    /**
     * Carrega todos os clientes ativos do Supabase.
     * Retorna no mesmo formato que o clients.json usava.
     */
    async getActiveClients() {
        if (!this.isAvailable()) return null;

        try {
            const { data, error } = await this.client
                .from('clients')
                .select('*')
                .eq('active', true)
                .order('name');

            if (error) throw error;

            // Mapear para o formato que o clientManager espera
            return data.map(c => ({
                id: c.slug,
                _supabase_id: c.id,
                name: c.name,
                tintim_instance_id: c.tintim_instance_id,
                tintim_account_code: c.tintim_account_code || '',
                tintim_account_token: c.tintim_account_token || '',
                spreadsheet_id: c.spreadsheet_id,
                sheet_name: c.sheet_name || 'auto',
                active: c.active,
            }));
        } catch (error) {
            logger.error('Erro ao carregar clientes do Supabase', { error: error.message });
            return null;
        }
    }

    /**
     * Carrega TODOS os clientes (ativos e inativos) para o painel admin.
     */
    async getAllClients() {
        if (!this.isAvailable()) return null;

        try {
            const { data, error } = await this.client
                .from('clients')
                .select('*')
                .order('name');

            if (error) throw error;

            return data.map(c => ({
                id: c.slug,
                _supabase_id: c.id,
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

    /**
     * Adiciona um novo cliente.
     */
    async addClient(clientData) {
        if (!this.isAvailable()) return null;

        try {
            const { data, error } = await this.client
                .from('clients')
                .insert({
                    slug: clientData.id,
                    name: clientData.name,
                    tintim_instance_id: clientData.tintim_instance_id,
                    tintim_account_code: clientData.tintim_account_code || '',
                    tintim_account_token: clientData.tintim_account_token || '',
                    spreadsheet_id: clientData.spreadsheet_id,
                    sheet_name: clientData.sheet_name || 'auto',
                    active: clientData.active !== false,
                })
                .select()
                .single();

            if (error) throw error;

            logger.info(`Cliente adicionado no Supabase: ${clientData.name}`);
            return data;
        } catch (error) {
            logger.error('Erro ao adicionar cliente no Supabase', { error: error.message });
            throw error;
        }
    }

    /**
     * Atualiza um cliente existente.
     */
    async updateClient(slug, updates) {
        if (!this.isAvailable()) return null;

        try {
            const { data, error } = await this.client
                .from('clients')
                .update({
                    name: updates.name,
                    tintim_instance_id: updates.tintim_instance_id,
                    tintim_account_code: updates.tintim_account_code || '',
                    tintim_account_token: updates.tintim_account_token || '',
                    spreadsheet_id: updates.spreadsheet_id,
                    sheet_name: updates.sheet_name || 'auto',
                    active: updates.active !== false,
                    updated_at: new Date(),
                })
                .eq('slug', slug)
                .select()
                .single();

            if (error) throw error;

            logger.info(`Cliente atualizado no Supabase: ${slug}`);
            return data;
        } catch (error) {
            logger.error('Erro ao atualizar cliente', { error: error.message });
            throw error;
        }
    }

    /**
     * Remove (desativa) um cliente pelo slug.
     */
    async deleteClient(slug) {
        if (!this.isAvailable()) return null;

        try {
            const { error } = await this.client
                .from('clients')
                .update({ active: false })
                .eq('slug', slug);

            if (error) throw error;

            logger.info(`Cliente desativado no Supabase: ${slug}`);
            return true;
        } catch (error) {
            logger.error('Erro ao desativar cliente', { error: error.message });
            throw error;
        }
    }

    // ============================================================
    // LEADS LOG (auditoria)
    // ============================================================

    /**
     * Registra um lead processado no banco.
     */
    async logLead(clientId, leadInfo) {
        if (!this.isAvailable()) return;

        try {
            // Buscar o UUID do cliente pelo slug
            let clientUuid = null;
            if (clientId) {
                const { data } = await this.client
                    .from('clients')
                    .select('id')
                    .eq('slug', clientId)
                    .single();
                clientUuid = data?.id || null;
            }

            const { error } = await this.client
                .from('leads_log')
                .insert({
                    client_id: clientUuid,
                    event_type: leadInfo.eventType || 'new_lead',
                    phone: leadInfo.phone,
                    lead_name: leadInfo.name,
                    status: leadInfo.status,
                    product: leadInfo.product,
                    sale_amount: leadInfo.saleAmount || null,
                    origin: leadInfo.origin || 'WhatsApp',
                    sheet_name: leadInfo.sheetName,
                    sheet_row: leadInfo.sheetRow || null,
                    processing_result: leadInfo.result || 'success',
                    error_message: leadInfo.error || null,
                });

            if (error) throw error;
        } catch (error) {
            // Não falhar o processamento por causa do log
            logger.warn('Erro ao registrar lead no Supabase', { error: error.message });
        }
    }

    /**
     * Busca os últimos logs de leads (atividade recente) para o dashboard.
     */
    async getRecentLeads(limit = 20) {
        if (!this.isAvailable()) return [];

        try {
            const { data, error } = await this.client
                .from('leads_log')
                .select(`
                    *,
                    clients ( name )
                `)
                .order('created_at', { ascending: false })
                .limit(limit);

            if (error) throw error;

            return data.map(log => ({
                id: log.id,
                client: log.clients?.name || 'Desconhecido',
                phone: log.phone,
                name: log.lead_name,
                status: log.status,
                event_type: log.event_type,
                timestamp: log.created_at,
                result: log.processing_result,
                error_message: log.error_message,
            }));
        } catch (error) {
            logger.error('Erro ao buscar logs recentes', { error: error.message });
            return [];
        }
    }

    /**
     * Busca logs de um cliente específico.
     */
    async getLeadsByClient(clientSlug, limit = 50) {
        if (!this.isAvailable()) return [];

        try {
            // 1. Buscar UUID do cliente
            const { data: clientData, error: clientError } = await this.client
                .from('clients')
                .select('id, name')
                .eq('slug', clientSlug)
                .single();

            if (clientError || !clientData) {
                logger.warn(`Cliente não encontrado para logs: ${clientSlug}`);
                return [];
            }

            // 2. Buscar logs
            const { data, error } = await this.client
                .from('leads_log')
                .select('*')
                .eq('client_id', clientData.id)
                .order('created_at', { ascending: false })
                .limit(limit);

            if (error) throw error;

            return {
                clientName: clientData.name,
                logs: data.map(log => ({
                    id: log.id,
                    client: clientData.name,
                    phone: log.phone,
                    name: log.lead_name,
                    status: log.status,
                    event_type: log.event_type,
                    timestamp: log.created_at,
                    result: log.processing_result,
                    error_message: log.error_message,
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
            const { count, error } = await this.client
                .from('leads_log')
                .select('*', { count: 'exact', head: true })
                .eq('processing_result', 'success') // Só leads processados com sucesso
                .eq('event_type', 'new_lead'); // Apenas novos leads, não updates

            if (error) throw error;
            return count;
        } catch (error) {
            return 0;
        }
    }

    /**
     * Verifica se já existe um webhook duplicado recente (idempotência).
     * Retorna true se é duplicado (já existe), false se é novo.
     */
    async checkDuplicateWebhook(phone, eventType, windowSeconds = 30) {
        if (!this.isAvailable()) return false;

        try {
            const windowStart = new Date(Date.now() - windowSeconds * 1000).toISOString();

            const query = this.client
                .from('webhook_events')
                .select('id', { count: 'exact', head: true })
                .gte('created_at', windowStart);

            if (phone) query.eq('phone', phone);
            if (eventType) query.eq('event_type', eventType);

            const { count, error } = await query;
            if (error) throw error;

            return (count || 0) > 0;
        } catch (error) {
            logger.warn('Erro ao verificar duplicata de webhook', { error: error.message });
            return false; // Na dúvida, processa
        }
    }

    /**
     * Busca atividade do dashboard — apenas leads_log (dados limpos, sem duplicatas).
     */
    async getDashboardActivity(limit = 20) {
        if (!this.isAvailable()) return [];

        try {
            const { data, error } = await this.client
                .from('leads_log')
                .select(`
                    *,
                    clients ( name )
                `)
                .order('created_at', { ascending: false })
                .limit(limit);

            if (error) throw error;

            return data.map(log => ({
                id: log.id,
                timestamp: log.created_at,
                phone: log.phone,
                client: log.clients?.name || 'Desconhecido',
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

    /**
     * Busca leads processados — apenas leads_log com suporte a filtros.
     */
    async getProcessedLeads(query, limit = 50) {
        if (!this.isAvailable()) return [];

        try {
            const cleanQuery = query ? query.replace(/[^\w\s-]/gi, '').trim() : '';
            let dbQuery = this.client
                .from('leads_log')
                .select(`*, clients ( name )`)
                .order('created_at', { ascending: false })
                .limit(limit);

            if (cleanQuery) {
                // Tentar identificar se é um slug de cliente
                const { data: clientData } = await this.client
                    .from('clients')
                    .select('id')
                    .eq('slug', cleanQuery)
                    .maybeSingle();

                if (clientData) {
                    dbQuery = dbQuery.eq('client_id', clientData.id);
                } else {
                    dbQuery = dbQuery.or(`phone.ilike.%${cleanQuery}%, lead_name.ilike.%${cleanQuery}%`);
                }
            }

            const { data, error } = await dbQuery;
            if (error) throw error;

            return data.map(log => ({
                id: log.id,
                timestamp: log.created_at,
                phone: log.phone,
                client: log.clients?.name || 'Desconhecido',
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
            logger.error('Erro na busca de leads processados', { error: error.message });
            return [];
        }
    }

    /**
     * Timeline completa de um lead por telefone (webhook_events + leads_log agrupados).
     */
    async getLeadTimeline(phone) {
        if (!this.isAvailable()) return [];

        try {
            const cleanPhone = phone.replace(/[^\d+]/g, '');

            const [eventsResult, logsResult] = await Promise.all([
                this.client
                    .from('webhook_events')
                    .select(`*, clients ( name )`)
                    .ilike('phone', `%${cleanPhone}%`)
                    .order('created_at', { ascending: true })
                    .limit(100),
                this.client
                    .from('leads_log')
                    .select(`*, clients ( name )`)
                    .ilike('phone', `%${cleanPhone}%`)
                    .order('created_at', { ascending: true })
                    .limit(100),
            ]);

            const events = (eventsResult.data || []).map(e => ({
                id: `evt_${e.id}`,
                timestamp: e.created_at,
                type: 'webhook',
                phone: e.phone,
                client: e.clients?.name || 'Desconhecido',
                event_type: e.event_type,
                status: e.processing_result,
                payload: e.payload,
            }));

            const logs = (logsResult.data || []).map(l => ({
                id: `log_${l.id}`,
                timestamp: l.created_at,
                type: 'processing',
                phone: l.phone,
                client: l.clients?.name || 'Desconhecido',
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
    // WEBHOOK EVENTS (debug/histórico)
    // ============================================================

    /**
     * Salva o payload bruto do webhook para histórico/debug.
     */
    async logWebhookEvent(payload, clientSlug, processingResult) {
        if (!this.isAvailable()) return;

        try {
            let clientUuid = null;
            if (clientSlug) {
                const { data } = await this.client
                    .from('clients')
                    .select('id')
                    .eq('slug', clientSlug)
                    .single();
                clientUuid = data?.id || null;
            }

            const { error } = await this.client
                .from('webhook_events')
                .insert({
                    client_id: clientUuid,
                    event_type: payload.event_type || null,
                    instance_id: payload.instanceId || null,
                    phone: payload.phone || null,
                    payload: payload,
                    processed: true,
                    processing_result: processingResult || 'success',
                });

            if (error) throw error;
        } catch (error) {
            logger.warn('Erro ao salvar evento webhook no Supabase', { error: error.message });
        }
    }
    // ============================================================
    // SYSTEM SETTINGS (chave-valor persistente)
    // ============================================================

    /**
     * Busca um valor de configuração pelo key.
     */
    async getSetting(key) {
        if (!this.isAvailable()) return null;

        try {
            const { data, error } = await this.client
                .from('system_settings')
                .select('value')
                .eq('key', key)
                .single();

            if (error) return null;
            return data?.value || null;
        } catch {
            return null;
        }
    }

    /**
     * Salva (upsert) um valor de configuração.
     */
    async setSetting(key, value) {
        if (!this.isAvailable()) return false;

        try {
            const { error } = await this.client
                .from('system_settings')
                .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });

            if (error) throw error;
            return true;
        } catch (error) {
            logger.error(`Erro ao salvar setting "${key}"`, { error: error.message });
            return false;
        }
    }
    // ============================================================
    // DASHBOARD & INVESTIGATION
    // ============================================================

    /**
     * Busca estatísticas agregadas para o dashboard (hoje)
     */
    async getDashboardStats() {
        if (!this.isAvailable()) return null;

        try {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const todayIso = today.toISOString();

            // 1. Novos Leads Hoje (leads_log com event_type=new_lead e sucesso)
            const { count: newLeadsCount, error: newLeadsError } = await this.client
                .from('leads_log')
                .select('*', { count: 'exact', head: true })
                .gte('created_at', todayIso)
                .eq('event_type', 'new_lead')
                .eq('processing_result', 'success');

            if (newLeadsError) throw newLeadsError;

            // 2. Vendas Hoje (leads_log com status contendo keywords de venda)
            const { data: salesData, error: salesError } = await this.client
                .from('leads_log')
                .select('id')
                .gte('created_at', todayIso)
                .eq('event_type', 'status_update')
                .eq('processing_result', 'success')
                .not('sale_amount', 'is', null);

            if (salesError) throw salesError;
            const salesCount = salesData ? salesData.length : 0;

            // 3. Erros Hoje (leads_log com resultado failed)
            const { count: errorCount, error: errorError } = await this.client
                .from('leads_log')
                .select('*', { count: 'exact', head: true })
                .gte('created_at', todayIso)
                .eq('processing_result', 'failed');

            if (errorError) throw errorError;

            // 4. Total processado hoje (para compatibilidade)
            const { count: processedCount, error: processedError } = await this.client
                .from('leads_log')
                .select('*', { count: 'exact', head: true })
                .gte('created_at', todayIso)
                .eq('processing_result', 'success');

            if (processedError) throw processedError;

            return {
                newLeads: newLeadsCount || 0,
                sales: salesCount || 0,
                errors: errorCount || 0,
                processed: processedCount || 0,
                // Mantém campos antigos para compatibilidade
                received: (newLeadsCount || 0) + salesCount,
            };
        } catch (error) {
            logger.error('Erro ao buscar stats do dashboard', { error: error.message });
            return null;
        }
    }

    /**
     * Busca leads por telefone, nome ou ID (Investigação)
     */
    /**
     * Busca leads por telefone, nome ou ID (Investigação)
     * Se query for vazia, retorna os últimos 20 registros gerais.
     */
    async searchAllEvents(query) {
        if (!this.isAvailable()) return [];

        try {
            const cleanQuery = query ? query.replace(/[^\w\s-]/gi, '').trim() : '';
            let clientUuid = null;

            // Tentar identificar se é um slug de cliente
            if (cleanQuery) {
                const { data: client } = await this.client
                    .from('clients')
                    .select('id')
                    .eq('slug', cleanQuery) // Exact match on slug
                    .maybeSingle();
                if (client) clientUuid = client.id;
            }

            let eventsPromise, logsPromise;

            if (!cleanQuery) {
                // Modo Auto-Load: Buscar últimos 20 de cada e combinar
                eventsPromise = this.client
                    .from('webhook_events')
                    .select(`*, clients ( name )`)
                    .order('created_at', { ascending: false })
                    .limit(20);

                logsPromise = this.client
                    .from('leads_log')
                    .select(`*, clients ( name )`)
                    .order('created_at', { ascending: false })
                    .limit(20);
            } else if (clientUuid) {
                // Modo Filtro por Cliente
                eventsPromise = this.client
                    .from('webhook_events')
                    .select(`*, clients ( name )`)
                    .eq('client_id', clientUuid)
                    .order('created_at', { ascending: false })
                    .limit(50);

                logsPromise = this.client
                    .from('leads_log')
                    .select(`*, clients ( name )`)
                    .eq('client_id', clientUuid)
                    .order('created_at', { ascending: false })
                    .limit(50);
            } else {
                // Modo Busca Específica (Telefone, Nome, Instance ID)
                eventsPromise = this.client
                    .from('webhook_events')
                    .select(`*, clients ( name )`)
                    .or(`phone.ilike.%${cleanQuery}%, payload->>chatName.ilike.%${cleanQuery}%, instance_id.eq.${cleanQuery}`)
                    .order('created_at', { ascending: false })
                    .limit(20);

                logsPromise = this.client
                    .from('leads_log')
                    .select(`*, clients ( name )`)
                    .or(`phone.ilike.%${cleanQuery}%, lead_name.ilike.%${cleanQuery}%`)
                    .order('created_at', { ascending: false })
                    .limit(20);
            }

            const [eventsResult, logsResult] = await Promise.all([eventsPromise, logsPromise]);

            const events = (eventsResult.data || []).map(e => ({
                id: `evt_${e.id}`,
                timestamp: e.created_at,
                phone: e.phone,
                client: e.clients?.name || 'Desconhecido',
                // Tenta extrair de vários lugares possíveis do payload Tintim
                name: e.payload?.name
                    || e.payload?.chatName
                    || e.payload?.pushName
                    || e.payload?.contact?.name
                    || e.payload?.contact?.pushname
                    || e.payload?.senderName
                    || 'Sem nome',
                status: e.processing_result === 'success' ? 'Recebido (Webhook)' : 'Erro (Webhook)',
                type: 'event',
                payload: e.payload
            }));

            const logs = (logsResult.data || []).map(l => ({
                id: `log_${l.id}`,
                timestamp: l.created_at,
                phone: l.phone,
                client: l.clients?.name || 'Desconhecido',
                name: l.lead_name || 'Sem nome', // Use lead_name column
                status: l.processing_result === 'success' ? `Processado: ${l.status}` : 'Erro Processamento',
                type: 'log',
                payload: {
                    event: l.event_type,
                    product: l.product,
                    amount: l.sale_amount,
                    origin: l.origin,
                    sheet: l.sheet_name,
                    error: l.error_message
                }
            }));

            // Combinar e ordenar por data
            return [...events, ...logs].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, 50);

        } catch (error) {
            logger.error('Erro na busca de leads (investigação)', { error: error.message });
            return [];
        }
    }

    /**
     * Busca os últimos erros registrados (para o painel de erros)
     */
    async getRecentErrors(limit = 50) {
        if (!this.isAvailable()) return [];

        try {
            const { data, error } = await this.client
                .from('webhook_events')
                .select(`
                    *,
                    clients ( name )
                `)
                .neq('processing_result', 'success')
                .order('created_at', { ascending: false })
                .limit(limit);

            if (error) throw error;

            return data.map(event => ({
                id: event.id,
                timestamp: event.created_at,
                client: event.clients?.name || 'Desconhecido',
                phone: event.phone,
                error_type: event.processing_result, // ex: "invalid", "no_client"
                payload: event.payload
            }));
        } catch (error) {
            logger.error('Erro ao buscar erros recentes', { error: error.message });
            return [];
        }
    }
}

const supabaseService = new SupabaseService();
module.exports = supabaseService;
