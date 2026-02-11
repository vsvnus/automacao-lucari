/**
 * Análise completa da planilha do cliente
 */
require('dotenv').config();
const { google } = require('googleapis');
const path = require('path');

const SPREADSHEET_ID = '1Gj5sYOAchnulEPA-KUg6M6aqCqkFZ3rSWPO_7vNJGoY';

async function analyze() {
    const keyFilePath = path.resolve(
        process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE || 'config/google-credentials.json'
    );

    const auth = new google.auth.GoogleAuth({
        keyFile: keyFilePath,
        scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const authClient = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: authClient });

    const spreadsheet = await sheets.spreadsheets.get({
        spreadsheetId: SPREADSHEET_ID,
    });

    console.log('========================================');
    console.log(`📊 PLANILHA: "${spreadsheet.data.properties.title}"`);
    console.log('========================================\n');

    const sheetsList = spreadsheet.data.sheets;
    console.log(`📑 Total de abas: ${sheetsList.length}`);
    console.log(`📑 Nomes das abas: ${sheetsList.map(s => `"${s.properties.title}"`).join(', ')}\n`);

    for (const sheet of sheetsList) {
        const title = sheet.properties.title;
        const rows = sheet.properties.gridProperties.rowCount;
        const cols = sheet.properties.gridProperties.columnCount;

        console.log(`\n=== ABA: "${title}" (${rows}x${cols}) ===`);

        try {
            const response = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range: `'${title}'!A1:Z15`,
            });

            const values = response.data.values || [];

            if (values.length === 0) {
                console.log('  (vazia)');
                continue;
            }

            console.log(`  Cabeçalhos (linha 1): ${JSON.stringify(values[0])}`);
            console.log(`  Total de linhas com dados: ${values.length}`);

            for (let i = 1; i < Math.min(values.length, 6); i++) {
                console.log(`  Linha ${i + 1}: ${JSON.stringify(values[i])}`);
            }

            if (values.length > 6) {
                console.log(`  ... (${values.length - 6} linhas adicionais)`);
            }
        } catch (error) {
            console.log(`  Erro ao ler: ${error.message}`);
        }
    }
}

analyze().catch(err => {
    console.error('Erro:', err.message);
    if (err.message.includes('not found')) {
        console.log('\n💡 Você compartilhou a planilha com automacao-wpp@automacao-planilha-487020.iam.gserviceaccount.com ?');
    }
});
