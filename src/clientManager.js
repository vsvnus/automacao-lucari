/**
 * ClientManager — Gerenciamento multi-cliente via Tintim
 * 
 * Fonte de dados (em ordem de prioridade):
 *   1. Supabase (se configurado) — persistente
 *   2. config/clients.json — fallback local
 * 
 * Cada cliente é identificado pelo instanceId do Tintim.
 */

const fs = require('fs');
const path = require('path');
const { logger } = require('./utils/logger');
const supabaseService = require('./supabaseService');

const CONFIG_PATH = path.join(__dirname, '..', 'config', 'clients.json');

class ClientManager {
    constructor() {
        this.clients = [];
        this.clientsByInstanceId = new Map();
        this.lastLoadTime = null;
        this.dataSource = 'local'; // 'supabase' ou 'local'
    }

    /**
     * Carrega clientes. Tenta Supabase primeiro, fallback para JSON local.
     */
    async loadClients() {
        // Tentar Supabase primeiro
        if (supabaseService.isAvailable()) {
            const supaClients = await supabaseService.getActiveClients();
            if (supaClients && supaClients.length > 0) {
                this._applyClients(supaClients);
                this.dataSource = 'supabase';
                logger.info(`${this.clients.length} cliente(s) carregado(s) do Supabase`);
                return this.clients;
            }
            logger.warn('Supabase disponível mas sem clientes, usando fallback local');
        }

        // Fallback: carregar do arquivo local
        return this._loadFromFile();
    }

    /**
     * Carrega clientes do arquivo JSON local.
     */
    _loadFromFile() {
        try {
            const configRaw = fs.readFileSync(CONFIG_PATH, 'utf-8');
            const config = JSON.parse(configRaw);

            if (!config.clients || !Array.isArray(config.clients)) {
                throw new Error('Formato inválido: "clients" deve ser um array');
            }

            const activeClients = config.clients.filter(c => c.active !== false);
            this._applyClients(activeClients);
            this.dataSource = 'local';
            logger.info(`${this.clients.length} cliente(s) carregado(s) do arquivo local`);
            return this.clients;
        } catch (error) {
            logger.error('Erro ao carregar clientes do arquivo local', { error: error.message });
            throw error;
        }
    }

    /**
     * Aplica a lista de clientes e reconstrói o índice.
     */
    _applyClients(clientsList) {
        this.clients = clientsList;
        this.clientsByInstanceId.clear();

        for (const client of this.clients) {
            if (!client.id || !client.name) {
                logger.warn('Cliente ignorado: falta id ou name', { client });
                continue;
            }

            if (client.tintim_instance_id) {
                this.clientsByInstanceId.set(client.tintim_instance_id, client);
            }

            logger.info(`Cliente carregado: ${client.name} (${client.id}) [${this.dataSource}]`);
        }

        this.lastLoadTime = new Date();
    }

    /**
     * Salva clientes no arquivo local (fallback).
     */
    saveClients(newClientsList) {
        try {
            const data = { clients: newClientsList };
            fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), 'utf-8');
            this._loadFromFile();
            return true;
        } catch (error) {
            logger.error('Erro ao salvar clientes', { error: error.message });
            throw error;
        }
    }

    /**
     * Adiciona um cliente. Persiste no Supabase se disponível.
     */
    async addClient(clientData) {
        // Tentar Supabase primeiro
        if (supabaseService.isAvailable()) {
            await supabaseService.addClient(clientData);
            await this.loadClients(); // Recarregar
            return clientData;
        }

        // Fallback: salvar no arquivo
        const configRaw = fs.readFileSync(CONFIG_PATH, 'utf-8');
        const config = JSON.parse(configRaw);

        if (config.clients.find(c => c.id === clientData.id)) {
            throw new Error(`Cliente "${clientData.id}" já existe`);
        }

        config.clients.push({ ...clientData, active: true });
        this.saveClients(config.clients);
        return clientData;
    }

    /**
     * Remove (desativa) um cliente.
     */
    async deleteClient(clientId) {
        // Tentar Supabase primeiro
        if (supabaseService.isAvailable()) {
            await supabaseService.deleteClient(clientId);
            await this.loadClients();
            return true;
        }

        // Fallback: remover do arquivo
        const configRaw = fs.readFileSync(CONFIG_PATH, 'utf-8');
        const config = JSON.parse(configRaw);
        const filtered = config.clients.filter(c => c.id !== clientId);

        if (filtered.length === config.clients.length) {
            throw new Error(`Cliente "${clientId}" não encontrado`);
        }

        this.saveClients(filtered);
        return true;
    }

    findByInstanceId(instanceId) {
        return this.clientsByInstanceId.get(instanceId) || null;
    }

    async reloadClients() {
        logger.info('Recarregando configurações...');
        return await this.loadClients();
    }

    async getAllClients() {
        // Tentar Supabase primeiro
        if (supabaseService.isAvailable()) {
            const supaClients = await supabaseService.getAllClients();
            if (supaClients) return supaClients;
        }

        // Fallback
        const configRaw = fs.readFileSync(CONFIG_PATH, 'utf-8');
        return JSON.parse(configRaw).clients;
    }

    getStats() {
        return {
            totalActiveClients: this.clients.length,
            lastLoadTime: this.lastLoadTime,
            dataSource: this.dataSource,
            clientNames: this.clients.map(c => c.name),
        };
    }
}

const clientManager = new ClientManager();
module.exports = clientManager;
