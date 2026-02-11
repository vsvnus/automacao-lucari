/**
 * ClientManager — Gerenciamento multi-cliente via Tintim
 * 
 * Cada cliente é identificado pelo instanceId do Tintim.
 */

const fs = require('fs');
const path = require('path');
const { logger } = require('./utils/logger');

const CONFIG_PATH = path.join(__dirname, '..', 'config', 'clients.json');

class ClientManager {
    constructor() {
        this.clients = [];
        this.clientsByInstanceId = new Map();
        this.lastLoadTime = null;
    }

    loadClients() {
        try {
            const configRaw = fs.readFileSync(CONFIG_PATH, 'utf-8');
            const config = JSON.parse(configRaw);

            if (!config.clients || !Array.isArray(config.clients)) {
                throw new Error('Formato inválido: "clients" deve ser um array');
            }

            this.clients = config.clients.filter(c => c.active !== false);
            this.clientsByInstanceId.clear();

            for (const client of this.clients) {
                if (!client.id || !client.name) {
                    logger.warn('Cliente ignorado: falta id ou name', { client });
                    continue;
                }

                if (client.tintim_instance_id) {
                    this.clientsByInstanceId.set(client.tintim_instance_id, client);
                }

                logger.info(`Cliente carregado: ${client.name} (${client.id})`);
            }

            this.lastLoadTime = new Date();
            logger.info(`${this.clients.length} cliente(s) ativo(s) carregado(s)`);
            return this.clients;
        } catch (error) {
            logger.error('Erro ao carregar clientes', { error: error.message });
            throw error;
        }
    }

    saveClients(newClientsList) {
        try {
            const data = { clients: newClientsList };
            fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), 'utf-8');
            this.loadClients();
            return true;
        } catch (error) {
            logger.error('Erro ao salvar clientes', { error: error.message });
            throw error;
        }
    }

    addClient(clientData) {
        const configRaw = fs.readFileSync(CONFIG_PATH, 'utf-8');
        const config = JSON.parse(configRaw);

        if (config.clients.find(c => c.id === clientData.id)) {
            throw new Error(`Cliente "${clientData.id}" já existe`);
        }

        config.clients.push({ ...clientData, active: true });
        this.saveClients(config.clients);
        return clientData;
    }

    deleteClient(clientId) {
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

    reloadClients() {
        logger.info('Recarregando configurações...');
        return this.loadClients();
    }

    getAllClients() {
        const configRaw = fs.readFileSync(CONFIG_PATH, 'utf-8');
        return JSON.parse(configRaw).clients;
    }

    getStats() {
        return {
            totalActiveClients: this.clients.length,
            lastLoadTime: this.lastLoadTime,
            clientNames: this.clients.map(c => c.name),
        };
    }
}

const clientManager = new ClientManager();
module.exports = clientManager;
