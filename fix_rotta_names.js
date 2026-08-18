/**
 * Script de correção retroativa — Rotta do Vale
 *
 * Problemas a corrigir:
 *   1. Leads com número de telefone no campo "Nome" (WPP desconectado no Tintim)
 *   2. Leads que podem estar faltando na planilha (perdidos durante desconexão)
 *
 * Abordagem:
 *   - Consulta webhook_events (payload JSONB) para buscar nomes reais dos leads
 *   - Cruza dados do PostgreSQL com a planilha do Google Sheets
 *   - Atualiza nomes retroativamente sem mexer em nada mais
 *
 * Modo DRY-RUN por padrão. Para aplicar: node fix_rotta_names.js --apply
 *
 * Execução via:
 *   docker exec <container> node fix_rotta_names.js           (dry-run)
 *   docker exec <container> node fix_rotta_names.js --apply   (aplicar)
 */

const { google } = require('googleapis');
const path = require('path');
const { Pool } = require('pg');

// ── Configuração ──────────────────────────────────────────────────
const DRY_RUN = !process.argv.includes('--apply');
const CLIENT_SLUG = 'Rotta-do-valle';

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

function initPool() {
    return new Pool({ connectionString: process.env.DATABASE_URL });
}

// ── Helpers ───────────────────────────────────────────────────────

function normalizePhone(p) {
    return (p || '').replace(/\D/g, '');
}

function phoneTail(p) {
    return normalizePhone(p).slice(-9);
}

function formatPhoneBR(phone) {
    const digits = normalizePhone(phone);
    // Remove DDI (55) se presente
    const local = digits.length >= 12 ? digits.slice(2) : digits;
    if (local.length === 11) {
        return `(${local.slice(0, 2)})${local.slice(2, 7)}-${local.slice(7)}`;
    }
    if (local.length === 10) {
        return `(${local.slice(0, 2)})${local.slice(2, 6)}-${local.slice(6)}`;
    }
    return phone;
}

function formatDateBR(isoStr) {
    if (!isoStr) return '';
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return '';
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
}

/**
 * Detecta se o nome de um lead é na verdade um número de telefone.
 * Padrões detectados:
 *   - "(XX)XXXXX-XXXX (Auto)"
 *   - "5527XXXXXXXXX (Auto)"
 *   - Qualquer nome onde, removendo "(Auto)" e espaços, sobram só dígitos/formatação
 */
function isPhoneAsName(name) {
    if (!name) return false;
    // Remover sufixo (Auto) / (Recuperado)
    const cleaned = name
        .replace(/\s*\(Auto\)\s*/gi, '')
        .replace(/\s*\(Recuperado\)\s*/gi, '')
        .trim();
    // Se o que sobrou é só dígitos + formatação de telefone
    const digitsOnly = cleaned.replace(/[\s()\-+]/g, '');
    return digitsOnly.length >= 8 && /^\d+$/.test(digitsOnly);
}

/**
 * Nomes que são na verdade o nome da CONTA do Tintim (fallback quando WPP offline).
 * Esses NÃO são nomes reais de leads e devem ser ignorados.
 */
function isAccountName(name) {
    if (!name) return false;
    const lower = name.toLowerCase().trim();
    return lower.includes('rotta do vale') ||
           lower.includes('orlandin') ||
           lower.includes('advogadas associadas');
}

function colLetter(idx) {
    return String.fromCharCode(65 + idx);
}

// ── Header Aliases (copiado de sheetsService.js) ──────────────────
const HEADER_ALIASES = {
    nome:           ['nome do lead', 'nome'],
    telefone:       ['telefone'],
    origem:         ['meio de contato', 'contato', 'fonte'],
    data:           ['data 1º contato', 'data 1', 'data 1o contato'],
    dataFechamento: ['data fechamento', 'data de fechamento'],
    valor:          ['valor de fechamento', 'valor'],
    cidade:         ['cidade'],
    produto:        ['produto'],
    status:         ['status lead', 'status', 'venda'],
    comentarios:    ['comentários', 'comentarios'],
};

async function getColumnMapping(sheets, spreadsheetId, sheetName) {
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${sheetName}'!1:1`,
    });
    const headers = (response.data.values || [[]])[0];
    const mapping = {};

    for (let i = 0; i < headers.length; i++) {
        const header = (headers[i] || '').trim().toLowerCase();
        if (!header) continue;
        for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
            if (mapping[field]) continue;
            if (aliases.some(alias => header === alias)) {
                mapping[field] = { index: i, letter: colLetter(i) };
                break;
            }
        }
    }
    mapping._totalCols = headers.length;
    mapping._headers = headers;
    return mapping;
}

// ── Core Logic ────────────────────────────────────────────────────

async function main() {
    console.log('='.repeat(60));
    console.log(`CORREÇÃO RETROATIVA — Rotta do Vale (Nomes de Leads)`);
    console.log(`Modo: ${DRY_RUN ? '🔍 DRY-RUN (simulação)' : '⚡ APLICAR CORREÇÕES'}`);
    console.log('='.repeat(60));

    const pool = initPool();
    const sheets = await initSheets();

    // 1. Buscar dados do cliente
    const { rows: clientRows } = await pool.query(
        "SELECT id, slug, name, spreadsheet_id FROM clients WHERE slug = $1",
        [CLIENT_SLUG]
    );

    if (clientRows.length === 0) {
        console.error(`Cliente "${CLIENT_SLUG}" não encontrado no banco.`);
        await pool.end();
        process.exit(1);
    }

    const client = clientRows[0];
    console.log(`\nCliente: ${client.name} (${client.slug})`);
    console.log(`Spreadsheet: ${client.spreadsheet_id}`);

    // 2. Determinar aba atual (Março-26)
    const spreadsheetMeta = await sheets.spreadsheets.get({
        spreadsheetId: client.spreadsheet_id,
        fields: 'sheets.properties.title',
    });
    const allSheetNames = spreadsheetMeta.data.sheets.map(s => s.properties.title);
    console.log(`Abas disponíveis: ${allSheetNames.join(', ')}`);

    // Buscar aba do mês atual (Março-26)
    const MESES_BR = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
        'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    const now = new Date();
    const mes = MESES_BR[now.getMonth()];
    const ano = String(now.getFullYear()).slice(-2);
    const targetSheetName = allSheetNames.find(name => {
        const normalized = name.replace(/\s+/g, '').toLowerCase();
        return normalized.includes(mes.toLowerCase()) && normalized.includes(ano);
    });

    if (!targetSheetName) {
        console.error(`Aba do mês atual (${mes}-${ano}) não encontrada!`);
        await pool.end();
        process.exit(1);
    }

    console.log(`\nAba alvo: "${targetSheetName}"`);

    // 3. Ler dados da planilha
    const colMap = await getColumnMapping(sheets, client.spreadsheet_id, targetSheetName);
    console.log(`Mapeamento: Nome=${colMap.nome?.letter}, Telefone=${colMap.telefone?.letter}, Data=${colMap.data?.letter}, Status=${colMap.status?.letter}`);

    const totalCols = colMap._totalCols || 14;
    const lastCol = colLetter(totalCols - 1);

    const dataResp = await sheets.spreadsheets.values.get({
        spreadsheetId: client.spreadsheet_id,
        range: `'${targetSheetName}'!A2:${lastCol}`,
    });
    const sheetRows = dataResp.data.values || [];
    console.log(`Total de linhas na planilha: ${sheetRows.length}`);

    // 4. Identificar linhas com telefone como nome
    const nomeIdx = colMap.nome ? colMap.nome.index : 0;
    const telIdx = colMap.telefone ? colMap.telefone.index : 1;
    const dataIdx = colMap.data ? colMap.data.index : 3;
    const statusIdx = colMap.status ? colMap.status.index : 7;

    const affectedRows = [];
    for (let i = 0; i < sheetRows.length; i++) {
        const row = sheetRows[i];
        const nome = (row[nomeIdx] || '').trim();
        const telefone = (row[telIdx] || '').trim();
        const data = (row[dataIdx] || '').trim();
        const status = (row[statusIdx] || '').trim();
        const rowNum = i + 2;

        if (isPhoneAsName(nome)) {
            affectedRows.push({ rowNum, nome, telefone, data, status, rowIndex: i });
        }
    }

    console.log(`\n📋 Leads com telefone no nome: ${affectedRows.length}`);
    for (const r of affectedRows) {
        console.log(`  Linha ${r.rowNum}: Nome="${r.nome}" | Tel="${r.telefone}" | Data="${r.data}" | Status="${r.status}"`);
    }

    if (affectedRows.length === 0) {
        console.log('\n✅ Nenhum lead com telefone no nome encontrado. Verificando leads faltantes...');
    }

    // 5. Buscar nomes reais do PostgreSQL
    // 5a. Buscar nos webhook_events — payloads originais e updates que tenham o nome correto
    console.log('\n🔎 Buscando nomes reais nos webhook_events...');

    const { rows: webhookEvents } = await pool.query(`
        SELECT
            we.phone,
            we.event_type,
            we.payload,
            we.processing_result,
            we.created_at
        FROM webhook_events we
        WHERE we.client_id = $1
          AND we.created_at >= NOW() - INTERVAL '60 days'
        ORDER BY we.created_at ASC
    `, [client.id]);

    console.log(`  Total webhook_events para Rotta: ${webhookEvents.length}`);

    // Construir mapa de telefone → melhor nome disponível
    // Prioridade: lead.update com chatName > lead.create com chatName > name do payload
    const phoneToName = new Map();

    for (const evt of webhookEvents) {
        const payload = typeof evt.payload === 'string' ? JSON.parse(evt.payload) : evt.payload;
        if (!payload) continue;

        const phone = normalizePhone(evt.phone || payload.phone || payload.phone_e164 || '');
        if (!phone) continue;

        const tail = phoneTail(phone);

        // Extrair nome de diversas fontes no payload
        const candidateNames = [
            payload.chatName,
            payload.name,
            payload.senderName,
            // NÃO incluir account.name — é o nome do escritório, não do lead
        ].filter(n => n && !isPhoneAsName(n) && !isAccountName(n) && n.trim().length > 1);

        if (candidateNames.length > 0) {
            const bestName = candidateNames[0].trim();
            const existing = phoneToName.get(tail);

            // lead.update tem prioridade (veio depois da reconexão, mais confiável)
            if (!existing || evt.event_type === 'lead.update') {
                phoneToName.set(tail, {
                    name: bestName,
                    phone: phone,
                    eventType: evt.event_type,
                    date: evt.created_at,
                });
            }
        }
    }

    console.log(`  Nomes reais encontrados nos webhooks: ${phoneToName.size}`);

    // 5b. Também buscar nos leads_log — pode ter nomes corretos de updates posteriores
    const { rows: leadsLog } = await pool.query(`
        SELECT
            phone,
            lead_name,
            event_type,
            created_at
        FROM leads_log
        WHERE client_id = $1
          AND created_at >= NOW() - INTERVAL '60 days'
          AND lead_name IS NOT NULL
        ORDER BY created_at ASC
    `, [client.id]);

    for (const log of leadsLog) {
        const tail = phoneTail(log.phone);
        if (!tail) continue;

        const name = (log.lead_name || '').replace(/\s*\(Auto\)\s*/gi, '').replace(/\s*\(Recuperado\)\s*/gi, '').trim();
        if (name && !isPhoneAsName(name) && !isAccountName(name) && name.length > 1) {
            const existing = phoneToName.get(tail);
            // lead.update em leads_log pode ter nome correto
            if (!existing || log.event_type === 'status_update') {
                phoneToName.set(tail, {
                    name: name,
                    phone: log.phone,
                    eventType: log.event_type,
                    date: log.created_at,
                });
            }
        }
    }

    console.log(`  Nomes totais disponíveis (webhook + leads_log): ${phoneToName.size}`);

    // 6. Cruzar: para cada lead afetado, tentar encontrar o nome real
    const fixes = [];
    const noNameFound = [];

    for (const affected of affectedRows) {
        const tail = phoneTail(affected.telefone);
        const match = phoneToName.get(tail);

        if (match) {
            fixes.push({
                rowNum: affected.rowNum,
                currentName: affected.nome,
                newName: match.name + ' (Auto)',
                telefone: affected.telefone,
                source: match.eventType,
            });
        } else {
            noNameFound.push(affected);
        }
    }

    console.log(`\n📊 Resultado do cruzamento:`);
    console.log(`  ✅ Nomes a corrigir: ${fixes.length}`);
    console.log(`  ❌ Sem nome disponível: ${noNameFound.length}`);

    if (fixes.length > 0) {
        console.log('\n📝 Correções planejadas:');
        for (const fix of fixes) {
            console.log(`  Linha ${fix.rowNum}: "${fix.currentName}" → "${fix.newName}" (fonte: ${fix.source})`);
        }
    }

    if (noNameFound.length > 0) {
        console.log('\n⚠️  Leads sem nome encontrado (precisam de correção manual ou consulta ao Tintim):');
        for (const r of noNameFound) {
            console.log(`  Linha ${r.rowNum}: Nome="${r.nome}" | Tel="${r.telefone}" | Data="${r.data}"`);
        }
    }

    // 7. Verificar leads faltantes (no PG mas não na planilha)
    console.log('\n🔎 Verificando leads faltantes na planilha...');

    const { rows: successLeads } = await pool.query(`
        SELECT
            phone,
            lead_name,
            status,
            origin,
            sheet_name,
            sheet_row,
            created_at,
            error_message
        FROM leads_log
        WHERE client_id = $1
          AND event_type = 'new_lead'
          AND processing_result = 'success'
          AND created_at >= NOW() - INTERVAL '60 days'
        ORDER BY created_at ASC
    `, [client.id]);

    // Telefones na planilha
    const sheetPhoneTails = new Set();
    for (const row of sheetRows) {
        const tel = (row[telIdx] || '').trim();
        const tail = phoneTail(tel);
        if (tail.length >= 8) sheetPhoneTails.add(tail);
    }

    // Também verificar na aba anterior (Fevereiro-26)
    const prevSheetName = allSheetNames.find(name => {
        const normalized = name.replace(/\s+/g, '').toLowerCase();
        return normalized.includes('fevereiro') && normalized.includes(ano);
    });

    if (prevSheetName) {
        const prevResp = await sheets.spreadsheets.values.get({
            spreadsheetId: client.spreadsheet_id,
            range: `'${prevSheetName}'!A2:${lastCol}`,
        });
        const prevRows = prevResp.data.values || [];
        for (const row of prevRows) {
            const tel = (row[telIdx] || '').trim();
            const tail = phoneTail(tel);
            if (tail.length >= 8) sheetPhoneTails.add(tail);
        }
        console.log(`  Incluindo telefones da aba "${prevSheetName}" (${prevRows.length} linhas)`);
    }

    const missingLeads = [];
    for (const lead of successLeads) {
        const tail = phoneTail(lead.phone);
        if (tail.length >= 8 && !sheetPhoneTails.has(tail)) {
            // Verificar se o nome real está disponível
            const nameMatch = phoneToName.get(tail);
            const candidateName = nameMatch ? nameMatch.name : lead.lead_name;
            const usableName = (candidateName && !isPhoneAsName(candidateName) && !isAccountName(candidateName))
                ? candidateName : null;
            missingLeads.push({
                phone: lead.phone,
                name: usableName,
                originalName: lead.lead_name,
                status: lead.status,
                origin: lead.origin,
                date: lead.created_at,
                sheetName: lead.sheet_name,
            });
        }
    }

    // Também checar leads filtrados como orgânicos que podem ter tido source_update para pago
    const { rows: filteredThenPaid } = await pool.query(`
        SELECT DISTINCT ON (l1.phone)
            l1.phone,
            l1.lead_name,
            l1.created_at
        FROM leads_log l1
        WHERE l1.client_id = $1
          AND l1.event_type = 'source_update'
          AND l1.processing_result = 'success'
          AND l1.created_at >= NOW() - INTERVAL '60 days'
          AND NOT EXISTS (
              SELECT 1 FROM leads_log l2
              WHERE l2.client_id = $1
                AND l2.event_type = 'new_lead'
                AND l2.processing_result = 'success'
                AND l2.phone = l1.phone
          )
        ORDER BY l1.phone, l1.created_at DESC
    `, [client.id]);

    for (const lead of filteredThenPaid) {
        const tail = phoneTail(lead.phone);
        if (tail.length >= 8 && !sheetPhoneTails.has(tail)) {
            const nameMatch = phoneToName.get(tail);
            const candidateName2 = nameMatch ? nameMatch.name : lead.lead_name;
            const usableName2 = (candidateName2 && !isPhoneAsName(candidateName2) && !isAccountName(candidateName2))
                ? candidateName2 : null;
            missingLeads.push({
                phone: lead.phone,
                name: usableName2,
                originalName: lead.lead_name,
                status: 'Lead Gerado',
                origin: 'Tráfego Pago',
                date: lead.created_at,
                sheetName: targetSheetName,
                fromSourceUpdate: true,
            });
        }
    }

    console.log(`  Leads no PG com sucesso: ${successLeads.length}`);
    console.log(`  Telefones na planilha: ${sheetPhoneTails.size}`);
    console.log(`  Leads faltantes: ${missingLeads.length}`);

    if (missingLeads.length > 0) {
        console.log('\n⚠️  Leads que deveriam estar na planilha mas não estão:');
        for (const ml of missingLeads) {
            console.log(`  Tel: ${ml.phone} | Nome: "${ml.name}" | Status: ${ml.status} | Origem: ${ml.origin} | Data: ${ml.date}${ml.fromSourceUpdate ? ' (source_update)' : ''}`);
        }
    }

    // 8. Aplicar correções (se não for dry-run)
    if (DRY_RUN) {
        console.log('\n' + '='.repeat(60));
        console.log('🔍 DRY-RUN COMPLETO — Nenhuma alteração foi feita.');
        console.log('Para aplicar as correções, execute: node fix_rotta_names.js --apply');
        console.log('='.repeat(60));
        await pool.end();
        return;
    }

    // 8a. Corrigir nomes na planilha
    if (fixes.length > 0) {
        console.log('\n⚡ Aplicando correções de nomes...');

        const nameUpdates = fixes.map(fix => ({
            range: `'${targetSheetName}'!${colMap.nome.letter}${fix.rowNum}`,
            values: [[fix.newName]],
        }));

        await sheets.spreadsheets.values.batchUpdate({
            spreadsheetId: client.spreadsheet_id,
            requestBody: {
                valueInputOption: 'RAW',
                data: nameUpdates,
            },
        });

        console.log(`  ✅ ${fixes.length} nomes corrigidos na planilha.`);
    }

    // 8b. Inserir leads faltantes (em ordem cronológica)
    if (missingLeads.length > 0) {
        console.log('\n⚡ Inserindo leads faltantes...');

        // Ordenar por data
        missingLeads.sort((a, b) => new Date(a.date) - new Date(b.date));

        // Re-ler os dados da planilha após as correções de nomes
        // para garantir posicionamento correto
        const freshDataResp = await sheets.spreadsheets.values.get({
            spreadsheetId: client.spreadsheet_id,
            range: `'${targetSheetName}'!A2:${lastCol}`,
        });
        const freshRows = freshDataResp.data.values || [];

        // Coletar telefones atualizados da planilha
        const updatedPhoneTails = new Set();
        for (const row of freshRows) {
            const tel = (row[telIdx] || '').trim();
            const tail = phoneTail(tel);
            if (tail.length >= 8) updatedPhoneTails.add(tail);
        }

        let insertedCount = 0;
        for (const ml of missingLeads) {
            const tail = phoneTail(ml.phone);
            // Dupla verificação: talvez já exista agora
            if (updatedPhoneTails.has(tail)) {
                console.log(`  SKIP: ${ml.phone} já está na planilha`);
                continue;
            }

            const leadName = (ml.name && !isPhoneAsName(ml.name))
                ? ml.name + ' (Auto)'
                : formatPhoneBR(ml.phone) + ' (Recuperado)';

            const leadDate = formatDateBR(ml.date);

            // Encontrar posição correta por data (simples — append no final por enquanto)
            // Depois a ordenação pode ser feita manualmente ou com outro script
            const nextRow = freshRows.length + 2 + insertedCount;

            const cellUpdates = [];
            const addCell = (field, value) => {
                if (colMap[field] && value) {
                    cellUpdates.push({
                        range: `'${targetSheetName}'!${colMap[field].letter}${nextRow}`,
                        values: [[value]],
                    });
                }
            };

            addCell('nome', leadName);
            addCell('telefone', formatPhoneBR(ml.phone));
            addCell('origem', ml.origin || 'WhatsApp');
            addCell('data', leadDate);
            addCell('status', ml.status || 'Lead Gerado');

            if (cellUpdates.length > 0) {
                await sheets.spreadsheets.values.batchUpdate({
                    spreadsheetId: client.spreadsheet_id,
                    requestBody: {
                        valueInputOption: 'USER_ENTERED',
                        data: cellUpdates,
                    },
                });

                console.log(`  ✅ Lead inserido na linha ${nextRow}: ${leadName} | ${formatPhoneBR(ml.phone)} | ${leadDate}`);
                updatedPhoneTails.add(tail);
                insertedCount++;

                // Rate limiting
                await new Promise(r => setTimeout(r, 500));
            }
        }

        console.log(`  ${insertedCount} leads faltantes inseridos.`);
    }

    console.log('\n' + '='.repeat(60));
    console.log('CORREÇÃO CONCLUÍDA');
    console.log(`  Nomes corrigidos: ${fixes.length}`);
    console.log(`  Leads inseridos: ${missingLeads.length}`);
    console.log(`  Sem nome disponível: ${noNameFound.length} (corrigir manualmente)`);
    console.log('='.repeat(60));

    await pool.end();
}

main().catch(e => {
    console.error('ERRO FATAL:', e);
    process.exit(1);
});
