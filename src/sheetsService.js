/**
 * SheetsService — Integração com Google Sheets API v4
 * 
 * Features:
 *   - Autenticação via Service Account
 *   - Abas mensais automáticas no formato "Mês-AA" (ex: "Fevereiro-26")
 *   - Segue o padrão de colunas existente do cliente
 *   - Retry com backoff exponencial
 */

const { google } = require('googleapis');
const path = require('path');
const { logger } = require('./utils/logger');

const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || '3', 10);
const RETRY_DELAY = parseInt(process.env.RETRY_DELAY || '2000', 10);

const MESES_BR = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

// Cabeçalhos padrão (conforme planilha real do cliente)
const HEADERS = [
    'Nome do Lead',
    'Telefone',
    'Meio de Contato',
    'Data 1º Contato',
    'Data Fechamento',
    'Valor de Fechamento',
    'Produto',
    'Status Lead',
    'DIA 1 ',
    'DIA 2',
    'DIA 3',
    'DIA 4',
    'DIA 5',
    'Comentários',
];

class SheetsService {
    constructor() {
        this.auth = null;
        this.sheets = null;
        this.drive = null;
        this.spreadsheetCache = new Map();
    }

    async initialize() {
        try {
            // Suporte para credenciais via Variável de Ambiente (Render/Cloud)
            // ou via arquivo (Local)
            let authConfig = {
                scopes: [
                    'https://www.googleapis.com/auth/spreadsheets',
                    'https://www.googleapis.com/auth/drive',
                ],
            };

            if (process.env.GOOGLE_CREDENTIALS_JSON) {
                // Em produção (Render), usamos a variável de ambiente com o JSON string
                try {
                    authConfig.credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
                    logger.info('Usando credenciais do Google via GOOGLE_CREDENTIALS_JSON');
                } catch (e) {
                    logger.error('Erro ao fazer parse do GOOGLE_CREDENTIALS_JSON', { error: e.message });
                    throw new Error('GOOGLE_CREDENTIALS_JSON inválido');
                }
            } else {
                // Em desenvolvimento, usamos o arquivo
                const keyFilePath = path.resolve(
                    process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE || 'config/google-credentials.json'
                );
                authConfig.keyFile = keyFilePath;
            }

            this.auth = new google.auth.GoogleAuth(authConfig);
            const authClient = await this.auth.getClient();
            this.sheets = google.sheets({ version: 'v4', auth: authClient });
            this.drive = google.drive({ version: 'v3', auth: authClient });

            logger.info('Google Sheets Service inicializado com sucesso');
            return true;
        } catch (error) {
            logger.error('Erro ao inicializar Google Sheets Service', { error: error.message });
            throw error;
        }
    }

    /**
     * Retorna nome da aba no formato "Mês-AA" (ex: "Fevereiro-26")
     * Segue o padrão existente na planilha do cliente
     */
    getCurrentMonthSheetName() {
        const now = new Date();
        const brDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
        const mes = MESES_BR[brDate.getMonth()];
        const ano = String(brDate.getFullYear()).slice(-2); // "2026" → "26"
        return `${mes}-${ano}`;
    }

    /**
     * Determina a aba correta.
     * Se sheet_name == "auto", procura uma aba existente do mês atual.
     * Se não encontrar, cria uma nova no formato "Mês-AA".
     */
    async resolveSheetName(client) {
        if (client.sheet_name !== 'auto') {
            const name = client.sheet_name || 'Leads';
            await this.ensureSheet(client.spreadsheet_id, name);
            return name;
        }

        // Modo auto: procurar aba existente do mês atual
        const targetName = this.getCurrentMonthSheetName(); // "Fevereiro-26"
        const cacheKey = `${client.spreadsheet_id}:resolved:${targetName}`;

        // Checar cache
        if (this.spreadsheetCache.has(cacheKey)) {
            return this.spreadsheetCache.get(cacheKey);
        }

        // Listar abas e procurar match flexível
        const spreadsheet = await this.sheets.spreadsheets.get({
            spreadsheetId: client.spreadsheet_id,
            fields: 'sheets.properties.title',
        });

        const existingSheets = spreadsheet.data.sheets.map(s => s.properties.title);

        // Extrair mês e ano do target para comparação flexível
        const brDate = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
        const mes = MESES_BR[brDate.getMonth()];
        const ano = String(brDate.getFullYear()).slice(-2);

        // Procurar aba que contenha o mês e o ano (flexível com espaços)
        const existingMatch = existingSheets.find(name => {
            const normalized = name.replace(/\s+/g, '').toLowerCase();
            return normalized.includes(mes.toLowerCase()) && normalized.includes(ano);
        });

        if (existingMatch) {
            logger.info(`Aba existente encontrada: "${existingMatch}" (match para ${targetName})`);
            this.spreadsheetCache.set(cacheKey, existingMatch);
            return existingMatch;
        }

        // Nenhuma aba do mês encontrada — criar nova
        await this.ensureSheet(client.spreadsheet_id, targetName, existingSheets);
        this.spreadsheetCache.set(cacheKey, targetName);
        return targetName;
    }

    /**
     * Garante que a aba existe. Se não, cria com cabeçalhos formatados.
     * Pode receber a lista de abas existentes para evitar re-fetch.
     */
    async ensureSheet(spreadsheetId, sheetName, existingSheetsList) {
        const cacheKey = `${spreadsheetId}:${sheetName}`;
        if (this.spreadsheetCache.has(cacheKey)) return;

        try {
            let existingSheets = existingSheetsList;
            if (!existingSheets) {
                const spreadsheet = await this.sheets.spreadsheets.get({
                    spreadsheetId,
                    fields: 'sheets.properties.title',
                });
                existingSheets = spreadsheet.data.sheets.map(s => s.properties.title);
            }

            if (existingSheets.includes(sheetName)) {
                this.spreadsheetCache.set(cacheKey, true);
                logger.debug(`Aba "${sheetName}" já existe`);
                return;
            }

            // Criar aba nova
            logger.info(`Criando nova aba: "${sheetName}"`);

            await this.sheets.spreadsheets.batchUpdate({
                spreadsheetId,
                requestBody: {
                    requests: [{
                        addSheet: {
                            properties: {
                                title: sheetName,
                                gridProperties: { frozenRowCount: 1 },
                            },
                        },
                    }],
                },
            });

            // Inserir cabeçalhos
            await this.sheets.spreadsheets.values.update({
                spreadsheetId,
                range: `'${sheetName}'!A1:N1`,
                valueInputOption: 'RAW',
                requestBody: { values: [HEADERS] },
            });

            // Formatar cabeçalho (negrito + fundo + texto branco)
            const newSheet = await this.sheets.spreadsheets.get({
                spreadsheetId,
                fields: 'sheets.properties',
            });

            const sheetId = newSheet.data.sheets
                .find(s => s.properties.title === sheetName)?.properties.sheetId;

            if (sheetId !== undefined) {
                await this.sheets.spreadsheets.batchUpdate({
                    spreadsheetId,
                    requestBody: {
                        requests: [
                            {
                                repeatCell: {
                                    range: {
                                        sheetId,
                                        startRowIndex: 0,
                                        endRowIndex: 1,
                                    },
                                    cell: {
                                        userEnteredFormat: {
                                            backgroundColor: { red: 0.15, green: 0.3, blue: 0.55 },
                                            textFormat: {
                                                bold: true,
                                                foregroundColor: { red: 1, green: 1, blue: 1 },
                                                fontSize: 10,
                                            },
                                            horizontalAlignment: 'CENTER',
                                        },
                                    },
                                    fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)',
                                },
                            },
                            {
                                autoResizeDimensions: {
                                    dimensions: {
                                        sheetId,
                                        dimension: 'COLUMNS',
                                        startIndex: 0,
                                        endIndex: 14,
                                    },
                                },
                            },
                        ],
                    },
                });
            }

            this.spreadsheetCache.set(cacheKey, true);
            logger.info(`✅ Aba "${sheetName}" criada com cabeçalhos do padrão do cliente`);

        } catch (error) {
            logger.error(`Erro ao garantir aba "${sheetName}"`, { error: error.message });
            throw error;
        }
    }

    /**
     * Insere um lead na planilha.
     * Usa values.update com célula exata para evitar deslocamento de colunas.
     * 
     * Colunas preenchidas pela automação:
     *   A: Nome do Lead
     *   B: Telefone
     *   C: Meio de Contato ("Meta Ads")
     *   D: Data 1º Contato
     *   G: Produto (auto-detectado)
     *   H: Status Lead ("Lead Gerado")
     *   N: Comentários ("Lead chegou no Wpp pelo Meta")
     * 
     * Colunas deixadas para a equipe:
     *   E: Data Fechamento
     *   F: Valor de Fechamento
     *   I-M: DIA 1 a DIA 5
     */
    async insertLead(client, leadData) {
        let lastError = null;

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                const spreadsheetId = client.spreadsheet_id;

                if (!spreadsheetId) {
                    throw new Error(`Cliente "${client.name}": spreadsheet_id não configurado`);
                }

                const sheetName = await this.resolveSheetName(client);

                // Encontrar a próxima linha vazia (após os dados existentes)
                const nextRow = await this.getNextEmptyRow(spreadsheetId, sheetName);

                // Montar linha COMPLETA com todas as 14 colunas (A-N)
                const row = [
                    leadData.name,           // A: Nome do Lead
                    leadData.phone,          // B: Telefone
                    'Meta Ads',              // C: Meio de Contato
                    leadData.date,           // D: Data 1º Contato
                    '',                      // E: Data Fechamento (equipe)
                    '',                      // F: Valor de Fechamento (equipe)
                    leadData.product || '',  // G: Produto
                    'Lead Gerado',           // H: Status Lead
                    '',                      // I: DIA 1 (equipe)
                    '',                      // J: DIA 2 (equipe)
                    '',                      // K: DIA 3 (equipe)
                    '',                      // L: DIA 4 (equipe)
                    '',                      // M: DIA 5 (equipe)
                    'Lead chegou no Wpp pelo Meta',  // N: Comentários
                ];

                // Usar values.update com célula exata (não append!)
                await this.sheets.spreadsheets.values.update({
                    spreadsheetId,
                    range: `'${sheetName}'!A${nextRow}:N${nextRow}`,
                    valueInputOption: 'RAW',
                    requestBody: { values: [row] },
                });

                // Formatar "(Auto)" em verde na célula do nome
                await this.formatAutoTag(spreadsheetId, sheetName, nextRow, leadData.name);

                logger.info(`Lead inserido em "${sheetName}"`, {
                    client: client.name,
                    phone: leadData.phone,
                    attempt,
                });

                return { success: true, attempt, sheetName };
            } catch (error) {
                lastError = error;
                logger.warn(`Tentativa ${attempt}/${MAX_RETRIES} falhou`, {
                    client: client.name,
                    error: error.message,
                });

                if (error.code === 404 || error.code === 400) {
                    this.spreadsheetCache.clear();
                }

                if (attempt < MAX_RETRIES) {
                    const delay = RETRY_DELAY * Math.pow(2, attempt - 1);
                    await this.sleep(delay);
                }
            }
        }

        logger.error(`Falha após ${MAX_RETRIES} tentativas`, {
            client: client.name,
            error: lastError?.message,
        });

        return { success: false, error: lastError?.message };
    }

    /**
     * Busca um lead na planilha pelo telefone (coluna B).
     * Usa normalização para comparar números independente da formatação.
     * Retorna o número da linha (1-indexed) ou null se não encontrar.
     */
    async findLeadRowByPhone(spreadsheetId, sheetName, phone) {
        try {
            const response = await this.sheets.spreadsheets.values.get({
                spreadsheetId,
                range: `'${sheetName}'!B:B`,
            });

            const values = response.data.values || [];

            // Normalizar: extrair só dígitos para comparação
            const normalizePhone = (p) => (p || '').replace(/\D/g, '');
            const targetDigits = normalizePhone(phone);

            // Pegar os últimos 8-9 dígitos (sem DDI/DDD) para match flexível
            const targetTail = targetDigits.slice(-9);

            for (let i = 1; i < values.length; i++) { // Pular cabeçalho (i=0)
                const cellDigits = normalizePhone(values[i][0]);
                const cellTail = cellDigits.slice(-9);

                if (cellTail === targetTail && targetTail.length >= 8) {
                    logger.info(`Lead encontrado na linha ${i + 1} pelo telefone ${phone}`);
                    return i + 1; // Linha 1-indexed
                }
            }

            return null; // Não encontrado
        } catch (error) {
            logger.warn(`Erro ao buscar lead por telefone em "${sheetName}"`, { error: error.message });
            return null;
        }
    }

    /**
     * Atualiza o status de um lead existente na planilha.
     * Atualiza colunas:
     *   E: Data Fechamento
     *   F: Valor de Fechamento
     *   H: Status Lead
     *   N: Comentários (append)
     */
    async updateLeadStatus(client, updateData) {
        let lastError = null;

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                const spreadsheetId = client.spreadsheet_id;
                if (!spreadsheetId) {
                    throw new Error(`Cliente "${client.name}": spreadsheet_id não configurado`);
                }

                const sheetName = await this.resolveSheetName(client);

                // Buscar a linha do lead pelo telefone
                const row = await this.findLeadRowByPhone(spreadsheetId, sheetName, updateData.phone);

                if (!row) {
                    logger.warn(`Lead não encontrado para atualização`, {
                        phone: updateData.phone,
                        client: client.name,
                    });
                    return { success: false, error: 'Lead não encontrado na planilha' };
                }

                // Preparar as atualizações em batch
                const updates = [];

                // Coluna A: Nome do Lead (se fornecido)
                if (updateData.name) {
                    updates.push({
                        range: `'${sheetName}'!A${row}`,
                        values: [[updateData.name]],
                    });
                }

                // Coluna E: Data Fechamento
                if (updateData.closeDate) {
                    updates.push({
                        range: `'${sheetName}'!E${row}`,
                        values: [[updateData.closeDate]],
                    });
                }

                // Coluna F: Valor de Fechamento
                if (updateData.saleAmount !== undefined && updateData.saleAmount !== null) {
                    const formattedValue = typeof updateData.saleAmount === 'number'
                        ? `R$ ${updateData.saleAmount.toFixed(2).replace('.', ',')}`
                        : updateData.saleAmount;
                    updates.push({
                        range: `'${sheetName}'!F${row}`,
                        values: [[formattedValue]],
                    });
                }

                // Coluna H: Status Lead
                if (updateData.status) {
                    updates.push({
                        range: `'${sheetName}'!H${row}`,
                        values: [[updateData.status]],
                    });
                }

                // Coluna N: Comentários (adicionar nota de atualização)
                if (updateData.comment) {
                    updates.push({
                        range: `'${sheetName}'!N${row}`,
                        values: [[updateData.comment]],
                    });
                }

                if (updates.length === 0) {
                    return { success: true, message: 'Nenhum campo para atualizar' };
                }

                // Executar todas as atualizações de uma vez
                await this.sheets.spreadsheets.values.batchUpdate({
                    spreadsheetId,
                    requestBody: {
                        valueInputOption: 'RAW',
                        data: updates,
                    },
                });

                logger.info(`Lead atualizado na linha ${row} de "${sheetName}"`, {
                    client: client.name,
                    phone: updateData.phone,
                    status: updateData.status,
                    saleAmount: updateData.saleAmount,
                    attempt,
                });

                return { success: true, attempt, sheetName, row };
            } catch (error) {
                lastError = error;
                logger.warn(`Tentativa ${attempt}/${MAX_RETRIES} de atualização falhou`, {
                    client: client.name,
                    error: error.message,
                });

                if (error.code === 404 || error.code === 400) {
                    this.spreadsheetCache.clear();
                }

                if (attempt < MAX_RETRIES) {
                    const delay = RETRY_DELAY * Math.pow(2, attempt - 1);
                    await this.sleep(delay);
                }
            }
        }

        logger.error(`Falha ao atualizar lead após ${MAX_RETRIES} tentativas`, {
            client: client.name,
            error: lastError?.message,
        });

        return { success: false, error: lastError?.message };
    }

    /**
     * Retorna o sheetId numérico de uma aba pelo nome.
     */
    async getSheetIdByName(spreadsheetId, sheetName) {
        try {
            const spreadsheet = await this.sheets.spreadsheets.get({
                spreadsheetId,
                fields: 'sheets.properties',
            });
            const sheet = spreadsheet.data.sheets.find(
                s => s.properties.title === sheetName
            );
            return sheet ? sheet.properties.sheetId : null;
        } catch (error) {
            logger.warn('Erro ao buscar sheetId', { error: error.message });
            return null;
        }
    }

    /**
     * Formata a tag "(Auto)" em verde e negrito dentro da célula do nome.
     * Usa textFormatRuns para rich text dentro de uma única célula.
     */
    async formatAutoTag(spreadsheetId, sheetName, row, fullName) {
        try {
            const autoTag = ' (Auto)';
            const tagStart = fullName.length - autoTag.length;

            if (tagStart < 0) return;

            const sheetId = await this.getSheetIdByName(spreadsheetId, sheetName);
            if (sheetId === null) return;

            await this.sheets.spreadsheets.batchUpdate({
                spreadsheetId,
                requestBody: {
                    requests: [{
                        updateCells: {
                            rows: [{
                                values: [{
                                    textFormatRuns: [
                                        {
                                            startIndex: 0,
                                            format: {},  // Formato padrão para o nome
                                        },
                                        {
                                            startIndex: tagStart,
                                            format: {
                                                foregroundColor: {
                                                    red: 0.18,
                                                    green: 0.72,
                                                    blue: 0.30,
                                                },
                                                bold: true,
                                                fontSize: 10,
                                            },
                                        },
                                    ],
                                }],
                            }],
                            fields: 'textFormatRuns',
                            range: {
                                sheetId,
                                startRowIndex: row - 1,
                                endRowIndex: row,
                                startColumnIndex: 0,
                                endColumnIndex: 1,
                            },
                        },
                    }],
                },
            });

            logger.debug(`Tag (Auto) formatada em verde na linha ${row}`);
        } catch (error) {
            // Não falhar a inserção por causa da formatação
            logger.warn('Erro ao formatar tag (Auto)', { error: error.message });
        }
    }

    /**
     * Encontra a próxima linha vazia na coluna A da aba.
     * Retorna o número da linha (1-indexed).
     */
    async getNextEmptyRow(spreadsheetId, sheetName) {
        try {
            const response = await this.sheets.spreadsheets.values.get({
                spreadsheetId,
                range: `'${sheetName}'!A:A`,
            });

            const values = response.data.values || [];
            return values.length + 1; // Próxima linha após a última com dados
        } catch (error) {
            logger.warn(`Erro ao buscar última linha em "${sheetName}"`, { error: error.message });
            return 2; // Fallback: linha 2 (após cabeçalho)
        }
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    clearCache() {
        this.spreadsheetCache.clear();
        logger.info('Cache limpo');
    }
}

const sheetsService = new SheetsService();
module.exports = sheetsService;
