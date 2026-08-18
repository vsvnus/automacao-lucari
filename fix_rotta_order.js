/**
 * Script para reordenar o lead de 20/02/2026 que ficou no final da planilha (linha 362).
 * Move para a posição cronológica correta.
 *
 * Execução: docker exec <container> node fix_rotta_order.js
 */

const { google } = require('googleapis');
const path = require('path');

const SPREADSHEET_ID = '1n5DWX26nQIPwN4HvLzd90HrB4AXkd3UQiLj6mcJgBp0';
const SHEET_NAME = 'Março-26';

async function initSheets() {
    let authConfig = {
        scopes: [
            'https://www.googleapis.com/auth/spreadsheets',
            'https://www.googleapis.com/auth/drive',
        ],
    };

    if (process.env.GOOGLE_CREDENTIALS_B64) {
        const decoded = Buffer.from(process.env.GOOGLE_CREDENTIALS_B64, 'base64').toString('utf-8');
        authConfig.credentials = JSON.parse(decoded);
    } else if (process.env.GOOGLE_CREDENTIALS_JSON) {
        authConfig.credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
    } else {
        authConfig.keyFile = path.resolve('config/google-credentials.json');
    }

    const auth = new google.auth.GoogleAuth(authConfig);
    const authClient = await auth.getClient();
    return google.sheets({ version: 'v4', auth: authClient });
}

function parseBRDate(str) {
    if (!str) return null;
    const parts = String(str).trim().split('/');
    if (parts.length !== 3) return null;
    const [d, m, y] = parts.map(Number);
    if (!d || !m || !y) return null;
    return new Date(y, m - 1, d);
}

async function main() {
    console.log('='.repeat(60));
    console.log('REORDENAÇÃO — Lead de 20/02/2026');
    console.log('='.repeat(60));

    const sheets = await initSheets();

    // 1. Ler a linha 362 inteira (o lead fora de ordem)
    const leadResp = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${SHEET_NAME}'!A362:Z362`,
        valueRenderOption: 'FORMATTED_VALUE',
    });
    const leadRow = leadResp.data.values ? leadResp.data.values[0] : null;

    if (!leadRow || leadRow.length === 0) {
        console.log('Linha 362 está vazia. Nada a fazer.');
        return;
    }

    console.log(`Lead na linha 362: Nome="${leadRow[0]}" | Tel="${leadRow[1]}" | Data="${leadRow[3]}"`);

    const leadDate = parseBRDate(leadRow[3]);
    if (!leadDate) {
        console.log('Data não reconhecida. Abortando.');
        return;
    }

    // 2. Ler todas as datas da coluna D para encontrar posição correta
    const dateResp = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${SHEET_NAME}'!D2:D370`,
    });
    const dates = (dateResp.data.values || []).map(r => r[0] || '');

    // Encontrar a posição correta (datas em ordem crescente)
    let insertAtRow = 2; // default: logo após header
    for (let i = 0; i < dates.length; i++) {
        const rowNum = i + 2;
        if (rowNum === 362) continue; // pular a própria linha
        const d = parseBRDate(dates[i]);
        if (d && d <= leadDate) {
            insertAtRow = rowNum + 1; // inserir DEPOIS desta linha
        }
    }

    console.log(`Posição correta: linha ${insertAtRow} (inserir antes desta linha)`);

    if (insertAtRow >= 362) {
        console.log('Lead já está na posição correta ou depois. Nada a mover.');
        return;
    }

    // Contexto
    const ctxResp = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${SHEET_NAME}'!A${Math.max(2, insertAtRow - 1)}:D${insertAtRow + 1}`,
    });
    console.log('Contexto ao redor da posição destino:');
    const ctxRows = ctxResp.data.values || [];
    for (let i = 0; i < ctxRows.length; i++) {
        const r = ctxRows[i];
        const lineNum = Math.max(2, insertAtRow - 1) + i;
        console.log(`  Linha ${lineNum}: Nome="${r[0]}" | Data="${r[3]}"`);
    }

    // 3. Obter o sheetId
    const meta = await sheets.spreadsheets.get({
        spreadsheetId: SPREADSHEET_ID,
        fields: 'sheets.properties',
    });
    const sheetObj = meta.data.sheets.find(s => s.properties.title === SHEET_NAME);
    if (!sheetObj) {
        console.error(`Aba "${SHEET_NAME}" não encontrada!`);
        return;
    }
    const sheetId = sheetObj.properties.sheetId;

    // 4. Usar moveDimension para mover a linha 362 para a posição correta
    // moveDimension move linhas de source para destinationIndex
    // Indices são 0-based: linha 362 = index 361
    // A linha precisa ir para antes de insertAtRow (0-based: insertAtRow - 1)
    console.log(`\nMovendo linha 362 (index 361) para antes da linha ${insertAtRow} (index ${insertAtRow - 1})...`);

    await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
            requests: [{
                moveDimension: {
                    source: {
                        sheetId,
                        dimension: 'ROWS',
                        startIndex: 361, // 0-based: linha 362
                        endIndex: 362,   // exclusive
                    },
                    destinationIndex: insertAtRow - 1, // 0-based
                },
            }],
        },
    });

    console.log('✅ Linha movida com sucesso!');

    // 5. Verificar resultado
    const verifyResp = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${SHEET_NAME}'!A${insertAtRow - 1}:D${insertAtRow + 1}`,
    });
    console.log('\nVerificação após mover:');
    const verifyRows = verifyResp.data.values || [];
    for (let i = 0; i < verifyRows.length; i++) {
        const r = verifyRows[i];
        const lineNum = insertAtRow - 1 + i;
        console.log(`  Linha ${lineNum}: Nome="${r[0]}" | Data="${r[3]}"`);
    }

    console.log('\n' + '='.repeat(60));
    console.log('REORDENAÇÃO CONCLUÍDA');
    console.log('='.repeat(60));
}

main().catch(e => {
    console.error('ERRO FATAL:', e.message);
    process.exit(1);
});
