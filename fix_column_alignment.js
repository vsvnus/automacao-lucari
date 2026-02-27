/**
 * Script de correção retroativa — Desalinhamento de colunas
 *
 * Corrige dados inseridos com colunas erradas nas planilhas dos clientes.
 * Deve ser executado UMA VEZ via: docker exec <container> node fix_column_alignment.js
 *
 * Correções:
 *   1. Perim Advocacia — Status/Produto deslocados, fórmulas DIA sobrescritas
 *   2. Mar das Ilhas + Rotta do Vale — Comentários na coluna N (deveria M)
 *   3. Lucas Raydan — Fórmulas DIA sobrescritas
 */

const { google } = require('googleapis');
const path = require('path');

// ── Configuração ──────────────────────────────────────────────────

const SHEET_NAME = 'Fevereiro-26';

// IDs das planilhas (buscar do banco ou config)
// Serão preenchidos automaticamente via PostgreSQL
let CLIENTS = {};

// ── Inicialização ─────────────────────────────────────────────────

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

async function loadClients() {
    // Tentar carregar do PostgreSQL
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
        const result = await pool.query("SELECT name, slug, spreadsheet_id FROM clients WHERE active = true");
        for (const row of result.rows) {
            CLIENTS[row.slug.toLowerCase()] = { name: row.name, spreadsheetId: row.spreadsheet_id };
        }
        console.log(`Clientes carregados do DB: ${Object.keys(CLIENTS).join(', ')}`);
    } catch (e) {
        console.error('Erro ao carregar clientes do DB:', e.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

// ── Helpers ───────────────────────────────────────────────────────

async function getHeaders(sheets, spreadsheetId, sheetName) {
    const resp = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${sheetName}'!1:1`,
    });
    return (resp.data.values || [[]])[0];
}

async function getAllRows(sheets, spreadsheetId, sheetName, lastCol) {
    const resp = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${sheetName}'!A2:${lastCol}`,
    });
    return resp.data.values || [];
}

async function getFormulas(sheets, spreadsheetId, sheetName, range) {
    const resp = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${sheetName}'!${range}`,
        valueRenderOption: 'FORMULA',
    });
    return resp.data.values || [];
}

function colLetter(idx) {
    return String.fromCharCode(65 + idx);
}

function isAutoLead(name) {
    return (name || '').includes('(Auto)') || (name || '').includes('(Recuperado)');
}

// ── Fix 1: Perim Advocacia ────────────────────────────────────────

async function fixPerim(sheets) {
    const client = CLIENTS['perim-advocacia'];
    if (!client) {
        console.log('SKIP: Perim não encontrado nos clientes');
        return;
    }

    console.log(`\n=== PERIM ADVOCACIA (${client.name}) ===`);
    const spreadsheetId = client.spreadsheetId;

    // Verificar headers
    const headers = await getHeaders(sheets, spreadsheetId, SHEET_NAME);
    console.log('Headers:', headers.map((h, i) => `${colLetter(i)}=${h}`).join(', '));

    // Perim: A=Nome, B=Telefone, C=Meio, D=Data, E=Fechamento, F=Valor, G=Cidade, H=Produto, I=Status, J-M=DIA 1-4, N=Comentários
    const colG = headers.findIndex(h => h.trim().toLowerCase() === 'cidade');
    const colH = headers.findIndex(h => h.trim().toLowerCase() === 'produto');
    const colI = headers.findIndex(h => h.trim().toLowerCase().includes('status'));

    if (colH === -1 || colI === -1) {
        console.log('ERRO: Colunas Produto/Status não encontradas. Headers:', headers);
        return;
    }

    console.log(`Colunas: Cidade=${colLetter(colG)}, Produto=${colLetter(colH)}, Status=${colLetter(colI)}`);

    // Ler dados
    const lastCol = colLetter(headers.length - 1);
    const rows = await getAllRows(sheets, spreadsheetId, SHEET_NAME, lastCol);
    console.log(`Total de linhas: ${rows.length}`);

    // Encontrar fórmulas DIA de linhas manuais (para usar como template)
    const diaStartIdx = headers.findIndex(h => h.trim().toLowerCase().startsWith('dia 1'));
    const diaEndIdx = headers.findIndex(h => h.trim().toLowerCase().startsWith('dia 4'));

    let diaFormulaTemplate = null;
    if (diaStartIdx !== -1) {
        const diaRange = `${colLetter(diaStartIdx)}2:${colLetter(diaEndIdx || diaStartIdx + 3)}${rows.length + 1}`;
        const formulas = await getFormulas(sheets, spreadsheetId, SHEET_NAME, diaRange);

        // Encontrar primeira linha manual com fórmulas
        for (let i = 0; i < formulas.length; i++) {
            const name = rows[i]?.[0] || '';
            if (!isAutoLead(name) && formulas[i]?.some(f => f && f.startsWith('='))) {
                diaFormulaTemplate = formulas[i];
                console.log(`Template de fórmulas DIA encontrado na linha ${i + 2}:`, diaFormulaTemplate);
                break;
            }
        }
    }

    // Preparar correções
    const updates = [];
    let fixCount = 0;

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const name = (row[0] || '').trim();
        const rowNum = i + 2; // 1-indexed, skip header

        if (!isAutoLead(name)) continue;

        const currentColG = (row[colG] || '').trim();
        const currentColH = (row[colH] || '').trim();
        const currentColI = (row[colI] || '').trim();

        // O bug: automação escreveu produto em G (deveria ser vazio/Cidade),
        // "Lead Gerado" em H (deveria ser Produto), e nada em I (deveria ser Status)
        const needsFix = currentColH === 'Lead Gerado' && !currentColI;

        if (!needsFix) {
            // Verificar caso Geraldo: "Comprou" escrito em H (Produto) ao invés de I (Status)
            if (currentColH === 'Comprou' || currentColH === 'comprou') {
                console.log(`  Linha ${rowNum}: "${name}" — Geraldo fix (Comprou em Produto → mover para Status)`);
                updates.push({
                    range: `'${SHEET_NAME}'!${colLetter(colH)}${rowNum}`,
                    values: [['']],
                });
                updates.push({
                    range: `'${SHEET_NAME}'!${colLetter(colI)}${rowNum}`,
                    values: [['Comprou']],
                });
                fixCount++;
            }
            continue;
        }

        console.log(`  Linha ${rowNum}: "${name}" — G="${currentColG}" H="${currentColH}" I="${currentColI}" → Fix`);

        // Limpar col G (Cidade) - tinha produto errado que a automação colocou
        if (currentColG) {
            updates.push({
                range: `'${SHEET_NAME}'!${colLetter(colG)}${rowNum}`,
                values: [['']],
            });
        }

        // Limpar col H (Produto) - tinha "Lead Gerado" que é status, não produto
        updates.push({
            range: `'${SHEET_NAME}'!${colLetter(colH)}${rowNum}`,
            values: [['']],
        });

        // Escrever "Lead Gerado" em col I (Status) onde deveria estar
        updates.push({
            range: `'${SHEET_NAME}'!${colLetter(colI)}${rowNum}`,
            values: [['Lead Gerado']],
        });

        fixCount++;
    }

    if (updates.length > 0) {
        await sheets.spreadsheets.values.batchUpdate({
            spreadsheetId,
            requestBody: {
                valueInputOption: 'RAW',
                data: updates,
            },
        });
        console.log(`Perim: ${fixCount} linhas corrigidas (${updates.length} células atualizadas)`);
    } else {
        console.log('Perim: Nenhuma correção necessária');
    }

    // Restaurar fórmulas DIA para linhas auto
    if (diaFormulaTemplate && diaStartIdx !== -1) {
        await restoreDiaFormulas(sheets, spreadsheetId, SHEET_NAME, rows, diaStartIdx, diaFormulaTemplate);
    }
}

// ── Fix 2: Mar das Ilhas + Rotta (comentários col N → M) ─────────

async function fixCommentColumn(sheets, clientSlug) {
    const client = CLIENTS[clientSlug];
    if (!client) {
        console.log(`SKIP: ${clientSlug} não encontrado`);
        return;
    }

    console.log(`\n=== ${client.name.toUpperCase()} ===`);
    const spreadsheetId = client.spreadsheetId;

    const headers = await getHeaders(sheets, spreadsheetId, SHEET_NAME);
    console.log('Headers:', headers.map((h, i) => `${colLetter(i)}=${h}`).join(', '));

    const totalCols = headers.length;
    const lastCol = colLetter(totalCols - 1);

    // Encontrar coluna de Comentários pelo header
    const comentariosIdx = headers.findIndex(h =>
        h.trim().toLowerCase() === 'comentários' || h.trim().toLowerCase() === 'comentarios'
    );

    if (comentariosIdx === -1) {
        console.log('ERRO: Coluna Comentários não encontrada. Headers:', headers);
        return;
    }

    console.log(`Coluna Comentários mapeada: ${colLetter(comentariosIdx)} (index ${comentariosIdx})`);

    // Se comentários já está na última coluna, verificar se há dados uma coluna além
    const rows = await getAllRows(sheets, spreadsheetId, SHEET_NAME, colLetter(Math.max(totalCols, 14) - 1));
    console.log(`Total de linhas: ${rows.length}`);

    const updates = [];
    let fixCount = 0;

    // A automação escreveu em col N (index 13) quando deveria ser col M (index 12)
    // Para planilhas com 13 colunas: Comentários = index 12 = col M
    const wrongIdx = 13; // N (index 13) - onde a automação errou
    const rightIdx = comentariosIdx;

    if (wrongIdx === rightIdx) {
        console.log('Colunas já estão alinhadas (Comentários = col N). Nada a corrigir.');
        return;
    }

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const name = (row[0] || '').trim();
        const rowNum = i + 2;

        if (!isAutoLead(name)) continue;

        const wrongValue = (row[wrongIdx] || '').trim();
        const rightValue = (row[rightIdx] || '').trim();

        // Se há conteúdo na coluna errada e a coluna certa está vazia, mover
        if (wrongValue && !rightValue) {
            console.log(`  Linha ${rowNum}: "${name}" — Mover "${wrongValue.substring(0, 40)}..." de ${colLetter(wrongIdx)} → ${colLetter(rightIdx)}`);

            updates.push({
                range: `'${SHEET_NAME}'!${colLetter(rightIdx)}${rowNum}`,
                values: [[wrongValue]],
            });
            updates.push({
                range: `'${SHEET_NAME}'!${colLetter(wrongIdx)}${rowNum}`,
                values: [['']],
            });
            fixCount++;
        }
    }

    if (updates.length > 0) {
        await sheets.spreadsheets.values.batchUpdate({
            spreadsheetId,
            requestBody: {
                valueInputOption: 'RAW',
                data: updates,
            },
        });
        console.log(`${client.name}: ${fixCount} linhas corrigidas`);
    } else {
        console.log(`${client.name}: Nenhuma correção necessária`);
    }
}

// ── Fix 3: Restaurar fórmulas DIA ────────────────────────────────

async function restoreDiaFormulas(sheets, spreadsheetId, sheetName, rows, diaStartIdx, template) {
    console.log(`\n  Restaurando fórmulas DIA...`);

    const formulaUpdates = [];
    let count = 0;

    for (let i = 0; i < rows.length; i++) {
        const name = (rows[i]?.[0] || '').trim();
        if (!isAutoLead(name)) continue;

        const rowNum = i + 2;

        // Para cada coluna DIA, adaptar a fórmula com o número da linha correto
        for (let d = 0; d < template.length; d++) {
            const formula = template[d];
            if (!formula || !formula.startsWith('=')) continue;

            // Substituir referências de linha do template pela linha atual
            // Template usa linhas do exemplo, precisamos adaptar para rowNum
            const adaptedFormula = adaptFormulaToRow(formula, rowNum);

            formulaUpdates.push({
                range: `'${sheetName}'!${colLetter(diaStartIdx + d)}${rowNum}`,
                values: [[adaptedFormula]],
            });
        }
        count++;
    }

    if (formulaUpdates.length > 0) {
        // Usar USER_ENTERED para que o Sheets interprete as fórmulas
        await sheets.spreadsheets.values.batchUpdate({
            spreadsheetId,
            requestBody: {
                valueInputOption: 'USER_ENTERED',
                data: formulaUpdates,
            },
        });
        console.log(`  ${count} linhas com fórmulas DIA restauradas (${formulaUpdates.length} células)`);
    }
}

function adaptFormulaToRow(formula, targetRow) {
    // Fórmulas DIA típicas: =IF(D5="";""D5+1), =IF(D5="";""D5+2), etc.
    // Precisamos substituir referências de linha (ex: D5 → D{targetRow})
    // Match: letra seguida de número(s) que é uma referência de célula
    return formula.replace(/([A-Z])(\d+)/g, (match, col, _rowStr) => {
        return `${col}${targetRow}`;
    });
}

// ── Fix 4: Lucas Raydan — Fórmulas DIA ───────────────────────────

async function fixRaydan(sheets) {
    const client = CLIENTS['raydan-advogados'];
    if (!client) {
        console.log('\nSKIP: Raydan não encontrado');
        return;
    }

    console.log(`\n=== LUCAS RAYDAN (${client.name}) ===`);
    const spreadsheetId = client.spreadsheetId;

    const headers = await getHeaders(sheets, spreadsheetId, SHEET_NAME);
    console.log('Headers:', headers.map((h, i) => `${colLetter(i)}=${h}`).join(', '));

    const lastCol = colLetter(headers.length - 1);
    const rows = await getAllRows(sheets, spreadsheetId, SHEET_NAME, lastCol);
    console.log(`Total de linhas: ${rows.length}`);

    // Encontrar colunas DIA
    const diaStartIdx = headers.findIndex(h => h.trim().toLowerCase().startsWith('dia 1'));
    if (diaStartIdx === -1) {
        console.log('Colunas DIA não encontradas');
        return;
    }

    // Buscar fórmulas de linha manual como template
    const diaCount = headers.filter(h => h.trim().toLowerCase().startsWith('dia')).length;
    const diaEndIdx = diaStartIdx + diaCount - 1;
    const diaRange = `${colLetter(diaStartIdx)}2:${colLetter(diaEndIdx)}${rows.length + 1}`;
    const formulas = await getFormulas(sheets, spreadsheetId, SHEET_NAME, diaRange);

    let diaFormulaTemplate = null;
    for (let i = 0; i < formulas.length; i++) {
        const name = rows[i]?.[0] || '';
        if (!isAutoLead(name) && formulas[i]?.some(f => f && f.startsWith('='))) {
            diaFormulaTemplate = formulas[i];
            console.log(`Template de fórmulas DIA da linha ${i + 2}:`, diaFormulaTemplate);
            break;
        }
    }

    if (!diaFormulaTemplate) {
        console.log('Nenhum template de fórmula DIA encontrado em linhas manuais');
        return;
    }

    await restoreDiaFormulas(sheets, spreadsheetId, SHEET_NAME, rows, diaStartIdx, diaFormulaTemplate);
}

// ── Main ──────────────────────────────────────────────────────────

async function main() {
    console.log('='.repeat(60));
    console.log('CORREÇÃO RETROATIVA — Desalinhamento de Colunas');
    console.log(`Aba alvo: ${SHEET_NAME}`);
    console.log('='.repeat(60));

    await loadClients();

    const sheets = await initSheets();

    // 1. Perim Advocacia
    try {
        await fixPerim(sheets);
    } catch (e) {
        console.error('ERRO Perim:', e.message);
    }

    // 2. Mar das Ilhas — comentários N → M
    try {
        await fixCommentColumn(sheets, 'mar-das-ilhas'); // slug: Mar-Das-Ilhas → lowercase
    } catch (e) {
        console.error('ERRO Mar das Ilhas:', e.message);
    }

    // 3. Rotta do Vale — comentários N → M
    try {
        await fixCommentColumn(sheets, 'rotta-do-valle'); // slug: Rotta-do-valle → lowercase
    } catch (e) {
        console.error('ERRO Rotta:', e.message);
    }

    // 4. Lucas Raydan — fórmulas DIA
    try {
        await fixRaydan(sheets);
    } catch (e) {
        console.error('ERRO Raydan:', e.message);
    }

    // 5. Harmoniza — nada a corrigir
    console.log('\n=== HARMONIZA ===');
    console.log('Sem correções necessárias (estrutura alinhada, sem fórmulas pré-existentes)');

    console.log('\n' + '='.repeat(60));
    console.log('CORREÇÃO CONCLUÍDA');
    console.log('='.repeat(60));
}

main().catch(e => {
    console.error('ERRO FATAL:', e);
    process.exit(1);
});
