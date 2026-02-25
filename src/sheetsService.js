/**
 * SheetsService — Integração com Google Sheets API v4
 *
 * Features:
 *   - Autenticação via Service Account
 *   - Abas mensais automáticas no formato "Mês-AA" (ex: "Fevereiro-26")
 *   - Mapeamento dinâmico de colunas (lê headers reais da planilha)
 *   - Retry com backoff exponencial
 */

const { google } = require('googleapis');
const path = require('path');
const { logger } = require('./utils/logger');
const pgService = require('./pgService');

const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || '3', 10);
const RETRY_DELAY = parseInt(process.env.RETRY_DELAY || '2000', 10);

const MESES_BR = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

// Status terminais — leads com esses status NÃO são levados para o mês seguinte
const TERMINAL_STATUSES = [
    'contato finalizado',
    'venda',
    'comprou',
    'desqualificado',
];

// Cabeçalhos padrão (fallback se não houver aba anterior para copiar)
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

// Aliases para mapeamento dinâmico de headers → campos lógicos
const HEADER_ALIASES = {
    nome:           ['nome do lead', 'nome'],
    telefone:       ['telefone'],
    origem:         ['meio de contato'],
    data:           ['data 1º contato', 'data 1', 'data 1o contato'],
    dataFechamento: ['data fechamento', 'data de fechamento'],
    valor:          ['valor de fechamento', 'valor'],
    cidade:         ['cidade'],
    produto:        ['produto'],
    status:         ['status lead', 'status'],
    dia1:           ['dia 1'],
    dia2:           ['dia 2'],
    dia3:           ['dia 3'],
    dia4:           ['dia 4'],
    dia5:           ['dia 5'],
    comentarios:    ['comentários', 'comentarios'],
};

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

            if (process.env.GOOGLE_CREDENTIALS_B64) {
                // Prefer base64-encoded credentials (avoids Docker build issues with newlines)
                try {
                    const decoded = Buffer.from(process.env.GOOGLE_CREDENTIALS_B64, 'base64').toString('utf-8');
                    const parsed = JSON.parse(decoded);
                    if (!parsed.client_email) throw new Error('client_email ausente');
                    authConfig.credentials = parsed;
                    logger.info('Usando credenciais do Google via GOOGLE_CREDENTIALS_B64');
                } catch (e) {
                    logger.warn('GOOGLE_CREDENTIALS_B64 inválido, tentando fallback...', { error: e.message });
                }
            }

            if (!authConfig.credentials && process.env.GOOGLE_CREDENTIALS_JSON) {
                // Fallback: JSON string (may have issues with newlines in Docker builds)
                try {
                    const parsed = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
                    if (!parsed.client_email) throw new Error('client_email ausente');
                    authConfig.credentials = parsed;
                    logger.info('Usando credenciais do Google via GOOGLE_CREDENTIALS_JSON');
                } catch (e) {
                    logger.warn('GOOGLE_CREDENTIALS_JSON inválido, tentando fallback...', { error: e.message });
                }
            }

            if (!authConfig.credentials) {
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
    async resolveSheetName(client, traceId) {
        if (client.sheet_name !== 'auto') {
            const name = client.sheet_name || 'Leads';
            await this.ensureSheet(client.spreadsheet_id, name, undefined, traceId);
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
        await this.ensureSheet(client.spreadsheet_id, targetName, existingSheets, traceId);

        // Copiar leads ativos do mês anterior para a nova aba
        const previousSheet = this.findPreviousMonthSheet(existingSheets);
        if (previousSheet) {
            await this.copyActiveLeadsFromSheet(client.spreadsheet_id, previousSheet, targetName);
        }

        this.spreadsheetCache.set(cacheKey, targetName);
        return targetName;
    }

    /**
     * Garante que a aba existe. Se não, cria com cabeçalhos formatados.
     * Copia headers da aba anterior se disponível (preserva estrutura do cliente).
     */
    async ensureSheet(spreadsheetId, sheetName, existingSheetsList, traceId) {
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

            // Determinar headers: copiar da aba anterior se disponível
            let headersToUse = HEADERS;
            if (existingSheets && existingSheets.length > 0) {
                const prevSheet = this.findPreviousMonthSheet(existingSheets);
                if (prevSheet) {
                    try {
                        const prevHeaders = await this.sheets.spreadsheets.values.get({
                            spreadsheetId,
                            range: `'${prevSheet}'!1:1`,
                        });
                        if (prevHeaders.data.values?.[0]?.length > 0) {
                            headersToUse = prevHeaders.data.values[0];
                            logger.info(`Headers copiados de "${prevSheet}" (${headersToUse.length} colunas)`);
                        }
                    } catch (e) {
                        logger.warn(`Falha ao copiar headers de "${prevSheet}": ${e.message}`);
                    }
                }
            }

            const lastColLetter = String.fromCharCode(64 + headersToUse.length);
            await this.sheets.spreadsheets.values.update({
                spreadsheetId,
                range: `'${sheetName}'!A1:${lastColLetter}1`,
                valueInputOption: 'RAW',
                requestBody: { values: [headersToUse] },
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
                                        endIndex: headersToUse.length,
                                    },
                                },
                            },
                        ],
                    },
                });
            }

            this.spreadsheetCache.set(cacheKey, true);
            logger.info(`Aba "${sheetName}" criada com ${headersToUse.length} colunas`);

            // Registrar criação de aba no trail
            if (traceId) {
                pgService.addTrailStep(traceId, 0, "tab_created", "ok", "Nova aba criada: " + sheetName, { sheetName, spreadsheetId }, null);
            }

        } catch (error) {
            logger.error(`Erro ao garantir aba "${sheetName}"`, { error: error.message });
            throw error;
        }
    }

    /**
     * Lê os headers (row 1) e retorna mapeamento campo → { index, letter }.
     * Cache por spreadsheetId:sheetName.
     *
     * Exemplo de retorno:
     *   { nome: { index: 0, letter: 'A' }, status: { index: 8, letter: 'I' }, ... _totalCols: 14 }
     */
    async getColumnMapping(spreadsheetId, sheetName) {
        const cacheKey = `${spreadsheetId}:${sheetName}:colmap`;
        if (this.spreadsheetCache.has(cacheKey)) {
            return this.spreadsheetCache.get(cacheKey);
        }

        const response = await this.sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `'${sheetName}'!1:1`,
        });

        const headers = (response.data.values || [[]])[0];
        const mapping = {};

        for (let i = 0; i < headers.length; i++) {
            const header = (headers[i] || '').trim().toLowerCase();
            if (!header) continue;

            for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
                if (mapping[field]) continue; // First match wins
                if (aliases.some(alias => header === alias)) {
                    mapping[field] = { index: i, letter: String.fromCharCode(65 + i) };
                    break;
                }
            }
        }

        mapping._totalCols = headers.length;

        const required = ['nome', 'telefone', 'status', 'comentarios'];
        const missing = required.filter(f => !mapping[f]);
        if (missing.length > 0) {
            logger.warn(`Colunas faltando em "${sheetName}": ${missing.join(', ')}`, { headers });
        }

        this.spreadsheetCache.set(cacheKey, mapping);
        logger.info(`Mapeamento de colunas para "${sheetName}":`, {
            produto: mapping.produto?.letter,
            status: mapping.status?.letter,
            comentarios: mapping.comentarios?.letter,
            totalCols: mapping._totalCols,
        });

        return mapping;
    }

    /**
     * Encontra a aba do mês anterior na lista de abas existentes.
     * Retorna o nome da aba ou null se não encontrar.
     */
    findPreviousMonthSheet(existingSheets) {
        const brDate = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
        // Mês anterior
        const prevDate = new Date(brDate);
        prevDate.setMonth(prevDate.getMonth() - 1);

        const prevMes = MESES_BR[prevDate.getMonth()];
        const prevAno = String(prevDate.getFullYear()).slice(-2);

        const match = existingSheets.find(name => {
            const normalized = name.replace(/\s+/g, '').toLowerCase();
            return normalized.includes(prevMes.toLowerCase()) && normalized.includes(prevAno);
        });

        if (match) {
            logger.info(`Aba do mês anterior encontrada: "${match}"`);
        }

        return match || null;
    }

    /**
     * Copia leads ativos do mês anterior para a nova aba do mês atual.
     * Usa mapeamento dinâmico para encontrar a coluna de status e as colunas a limpar.
     */
    async copyActiveLeadsFromSheet(spreadsheetId, sourceSheetName, targetSheetName) {
        try {
            const colMap = await this.getColumnMapping(spreadsheetId, sourceSheetName);
            const totalCols = colMap._totalCols || 14;
            const lastCol = String.fromCharCode(64 + totalCols);

            const response = await this.sheets.spreadsheets.values.get({
                spreadsheetId,
                range: `'${sourceSheetName}'!A2:${lastCol}`,
            });

            const allRows = response.data.values || [];

            if (allRows.length === 0) {
                logger.info(`Aba "${sourceSheetName}" está vazia, nada para copiar`);
                return;
            }

            // Filtrar por status usando coluna mapeada
            const statusIdx = colMap.status ? colMap.status.index : 7;
            const activeRows = allRows.filter(row => {
                const status = (row[statusIdx] || '').toLowerCase().trim();
                const isTerminal = TERMINAL_STATUSES.some(ts => status.includes(ts));
                return !isTerminal;
            });

            if (activeRows.length === 0) {
                logger.info(`Nenhum lead ativo para copiar de "${sourceSheetName}"`);
                return;
            }

            // Índices das colunas a limpar (DIAs, Comentários, Fechamento)
            const cleanIndices = [];
            for (const field of ['dia1', 'dia2', 'dia3', 'dia4', 'dia5', 'comentarios', 'dataFechamento', 'valor']) {
                if (colMap[field]) cleanIndices.push(colMap[field].index);
            }

            const cleanedRows = activeRows.map(row => {
                const newRow = [...row];
                while (newRow.length < totalCols) newRow.push('');
                for (const idx of cleanIndices) {
                    if (idx < newRow.length) newRow[idx] = '';
                }
                return newRow;
            });

            // Inserir os leads ativos na nova aba (a partir da linha 2, após cabeçalho)
            await this.sheets.spreadsheets.values.update({
                spreadsheetId,
                range: `'${targetSheetName}'!A2:${lastCol}${cleanedRows.length + 1}`,
                valueInputOption: 'RAW',
                requestBody: { values: cleanedRows },
            });

            logger.info(`${cleanedRows.length} leads ativos copiados de "${sourceSheetName}" para "${targetSheetName}" (${allRows.length - cleanedRows.length} excluídos por status terminal)`);

        } catch (error) {
            // Não falhar a criação da aba por causa da cópia
            logger.error(`Erro ao copiar leads ativos de "${sourceSheetName}"`, { error: error.message });
        }
    }

    /**
     * Insere um lead na planilha usando mapeamento dinâmico de colunas.
     * Escreve SOMENTE nas colunas necessárias via batchUpdate (células individuais).
     * NUNCA escreve nas colunas DIA (preserva fórmulas existentes).
     * NUNCA escreve em Cidade, Data Fechamento, Valor (equipe preenche).
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
                const colMap = await this.getColumnMapping(spreadsheetId, sheetName);

                // Encontrar a próxima linha vazia (após os dados existentes)
                const nextRow = await this.getNextEmptyRow(spreadsheetId, sheetName);

                // Montar atualizações individuais por célula
                const updates = [];
                const addCell = (field, value) => {
                    if (colMap[field] && value !== undefined && value !== null) {
                        updates.push({
                            range: `'${sheetName}'!${colMap[field].letter}${nextRow}`,
                            values: [[value]],
                        });
                    }
                };

                // Colunas sempre preenchidas
                addCell('nome', leadData.name);
                addCell('telefone', leadData.phone);
                addCell('origem', leadData.origin || 'WhatsApp');
                addCell('data', leadData.date);

                // Produto: SOMENTE se detectado (preserva dropdown validation)
                if (leadData.product) {
                    addCell('produto', leadData.product);
                }

                // Status: usa valor do leadData (default "Lead Gerado")
                addCell('status', leadData.status || 'Lead Gerado');

                // Comentários: usa coluna mapeada
                addCell('comentarios', leadData.originComment || 'Lead recebido via automação');

                // Para leads recuperados: escreve fechamento/valor se fornecidos
                if (leadData.closeDate) {
                    addCell('dataFechamento', leadData.closeDate);
                }
                if (leadData.saleAmount && leadData.saleAmount > 0) {
                    const formattedValue = typeof leadData.saleAmount === 'number'
                        ? `R$ ${leadData.saleAmount.toFixed(2).replace('.', ',')}`
                        : leadData.saleAmount;
                    addCell('valor', formattedValue);
                }

                // NUNCA escreve: DIA 1-5, Cidade

                if (updates.length === 0) {
                    throw new Error('Nenhuma coluna mapeada para inserção');
                }

                // Usar batchUpdate com células individuais (não sobrescreve DIAs)
                await this.sheets.spreadsheets.values.batchUpdate({
                    spreadsheetId,
                    requestBody: {
                        valueInputOption: 'RAW',
                        data: updates,
                    },
                });

                // Formatar "(Auto)" em verde na célula do nome
                await this.formatAutoTag(spreadsheetId, sheetName, nextRow, leadData.name);

                logger.info(`Lead inserido em "${sheetName}" (mapeamento dinâmico)`, {
                    client: client.name,
                    phone: leadData.phone,
                    attempt,
                    columns: updates.map(u => u.range.split('!')[1]),
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
     * Retorna lista de nomes de abas mensais existentes, ordenadas da mais recente para a mais antiga.
     */
    async getMonthlySheetNames(spreadsheetId) {
        try {
            const spreadsheet = await this.sheets.spreadsheets.get({
                spreadsheetId,
                fields: 'sheets.properties.title',
            });

            const allSheets = spreadsheet.data.sheets.map(s => s.properties.title);

            // Filtrar apenas abas que parecem mensais (formato "Mês-AA")
            const monthlyPattern = new RegExp(
                `^(${MESES_BR.join('|')})[\\s-]*(\\d{2})$`, 'i'
            );

            const monthlySheets = allSheets
                .filter(name => monthlyPattern.test(name.replace(/\s+/g, '')))
                .sort((a, b) => {
                    // Ordenar por ano-mês decrescente
                    const parseSheet = (name) => {
                        const normalized = name.replace(/\s+/g, '');
                        const match = normalized.match(monthlyPattern);
                        if (!match) return 0;
                        const mesIdx = MESES_BR.findIndex(m => m.toLowerCase() === match[1].toLowerCase());
                        const ano = parseInt(match[2], 10);
                        return ano * 12 + mesIdx;
                    };
                    return parseSheet(b) - parseSheet(a);
                });

            return monthlySheets;
        } catch (error) {
            logger.warn('Erro ao listar abas mensais', { error: error.message });
            return [];
        }
    }

    /**
     * Atualiza o status de um lead existente na planilha.
     * Usa mapeamento dinâmico de colunas para encontrar as colunas corretas.
     * Busca primeiro no mês atual, depois em meses anteriores.
     */
    async updateLeadStatus(client, updateData) {
        let lastError = null;

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                const spreadsheetId = client.spreadsheet_id;
                if (!spreadsheetId) {
                    throw new Error(`Cliente "${client.name}": spreadsheet_id não configurado`);
                }

                const currentSheetName = await this.resolveSheetName(client);

                // Buscar a linha do lead pelo telefone — primeiro no mês atual
                let row = await this.findLeadRowByPhone(spreadsheetId, currentSheetName, updateData.phone);
                let sheetName = currentSheetName;

                // Se não encontrou no mês atual, buscar em meses anteriores
                if (!row) {
                    logger.info(`Lead não encontrado em "${currentSheetName}", buscando em meses anteriores...`, {
                        phone: updateData.phone,
                        client: client.name,
                    });

                    const monthlySheets = await this.getMonthlySheetNames(spreadsheetId);

                    for (const prevSheet of monthlySheets) {
                        if (prevSheet === currentSheetName) continue; // Já buscamos
                        row = await this.findLeadRowByPhone(spreadsheetId, prevSheet, updateData.phone);
                        if (row) {
                            sheetName = prevSheet;
                            logger.info(`Lead encontrado em aba anterior: "${prevSheet}" linha ${row}`, {
                                phone: updateData.phone,
                            });
                            break;
                        }
                    }
                }

                if (!row) {
                    logger.warn(`Lead não encontrado para atualização em nenhuma aba`, {
                        phone: updateData.phone,
                        client: client.name,
                    });
                    return { success: false, error: 'Lead não encontrado na planilha' };
                }

                // Obter mapeamento de colunas da aba onde o lead foi encontrado
                const colMap = await this.getColumnMapping(spreadsheetId, sheetName);

                // Preparar as atualizações em batch usando colunas mapeadas
                const updates = [];

                // Nome do Lead
                if (updateData.name && colMap.nome) {
                    updates.push({
                        range: `'${sheetName}'!${colMap.nome.letter}${row}`,
                        values: [[updateData.name]],
                    });
                }

                // Data Fechamento
                if (updateData.closeDate && colMap.dataFechamento) {
                    updates.push({
                        range: `'${sheetName}'!${colMap.dataFechamento.letter}${row}`,
                        values: [[updateData.closeDate]],
                    });
                }

                // Valor de Fechamento
                if (updateData.saleAmount !== undefined && updateData.saleAmount !== null && colMap.valor) {
                    const formattedValue = typeof updateData.saleAmount === 'number'
                        ? `R$ ${updateData.saleAmount.toFixed(2).replace('.', ',')}`
                        : updateData.saleAmount;
                    updates.push({
                        range: `'${sheetName}'!${colMap.valor.letter}${row}`,
                        values: [[formattedValue]],
                    });
                }

                // Status Lead (coluna mapeada, não hardcoded H)
                if (updateData.status && colMap.status) {
                    updates.push({
                        range: `'${sheetName}'!${colMap.status.letter}${row}`,
                        values: [[updateData.status]],
                    });
                }

                // Comentários (coluna mapeada, não hardcoded N)
                if (updateData.comment && colMap.comentarios) {
                    updates.push({
                        range: `'${sheetName}'!${colMap.comentarios.letter}${row}`,
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

                logger.info(`Lead atualizado na linha ${row} de "${sheetName}" (mapeamento dinâmico)`, {
                    client: client.name,
                    phone: updateData.phone,
                    status: updateData.status,
                    saleAmount: updateData.saleAmount,
                    attempt,
                    columns: updates.map(u => u.range.split('!')[1]),
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
