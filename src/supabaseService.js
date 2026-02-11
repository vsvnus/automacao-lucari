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
}

const supabaseService = new SupabaseService();
module.exports = supabaseService;
