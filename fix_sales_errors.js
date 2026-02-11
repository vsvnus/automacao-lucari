
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const sheetsService = require('./src/sheetsService');
const clientManager = require('./src/clientManager');
const { v4: uuidv4 } = require('uuid');

// Config
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('❌ Credenciais do Supabase ausentes no .env');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Initialize Sheets Service
if (!sheetsService.initialize()) {
    console.error('❌ Falha ao inicializar Google Sheets Service');
    process.exit(1);
}

// Status keywords that indicate a SALE (copied from webhookHandler)
const SALE_STATUS_KEYWORDS = [
    'venda', 'vendido', 'fechou', 'fechado', 'ganho', 'ganhou',
    'convertido', 'contrato', 'assinado', 'pago', 'pagou',
    'sale', 'won', 'closed', 'comprou',
];

function isSaleStatus(statusName) {
    if (!statusName) return false;
    const normalized = statusName.toLowerCase().trim();
    return SALE_STATUS_KEYWORDS.some(kw => normalized.includes(kw));
}

async function fixSalesErrors() {
    console.log('🔍 Iniciando recuperação de vendas falhas...');

    // 0. Carregar clientes do Supabase para ter os UUIDs corretos
    const { data: clientsData, error: clientsError } = await supabase
        .from('clients')
        .select('*');

    if (clientsError) {
        console.error('❌ Erro ao carregar clientes:', clientsError);
        return;
    }

    // Criar mapa de ID -> Cliente (formato esperado pelo sheetsService)
    const clientsMap = {};
    clientsData.forEach(c => {
        // Objeto de cliente precisa ser compatível com sheetsService
        clientsMap[c.id] = {
            id: c.slug,
            _supabase_id: c.id,
            name: c.name,
            tintim_instance_id: c.tintim_instance_id,
            spreadsheet_id: c.spreadsheet_id,
            sheet_name: c.sheet_name || 'auto',
            active: c.active,
        };
    });

    console.log(`✅ ${clientsData.length} clientes carregados do Supabase.`);
    // Debug: imprimir IDs para conferência
    console.log('🔑 IDs disponíveis:', Object.keys(clientsMap));

    // 1. Buscar logs com erro "não encontrado"
    // Note: ILIKE '%não encontrado%' match error messages
    const { data: logs, error } = await supabase
        .from('leads_log')
        .select('*')
        .eq('processing_result', 'failed') // Correct column name
        .ilike('error_message', '%não encontrado%');

    if (error) {
        console.error('❌ Erro ao buscar logs:', error);
        return;
    }

    console.log(`📋 Encontrados ${logs.length} logs com erro "não encontrado". Filtrando por vendas...`);

    let recoveredCount = 0;

    for (const log of logs) {
        // Filtrar apenas se for Venda ou tiver valor
        // Check if status contains "Venda" or similar, or sale_amount > 0
        const isSale = isSaleStatus(log.status) || (log.sale_amount && log.sale_amount > 0);

        if (!isSale) {
            console.log(`⏭️ Ignorando log ID ${log.id} (Status: "${log.status}" não é venda)`);
            continue;
        }

        console.log(`🔄 Recuperando log ID ${log.id} - Cliente: ${log.client_id} - Lead: ${log.lead_name}`);

        // Identificar cliente pelo UUID usando o mapa carregado do Supabase
        const client = clientsMap[log.client_id];

        if (!client) {
            console.error(`   ❌ Cliente UUID ${log.client_id} não encontrado no mapa de clientes.`);
            continue;
        }

        // Montar payload de recuperação
        const recoveryLeadData = {
            name: (log.lead_name || log.phone) + ' (Recuperado)',
            phone: log.phone,
            origin: 'WhatsApp',
            date: new Date(log.created_at).toLocaleDateString('pt-BR'), // Usar data do log original
            product: log.product || 'Indefinido',
            status: `Venda (Recuperada)`, // Status especial
            phoneRaw: log.phone,
            leadId: uuidv4(),
            saleAmount: log.sale_amount || 0,
            closeDate: new Date(log.created_at).toLocaleDateString('pt-BR'),
        };

        // Tentar inserir na planilha
        const insertResult = await sheetsService.insertLead(client, recoveryLeadData);

        if (insertResult.success) {
            console.log(`   ✅ Inserido na planilha: ${insertResult.sheetName}`);

            // Atualizar o LOG original para sucesso/warning
            const { error: updateError } = await supabase
                .from('leads_log')
                .update({
                    processing_result: 'success', // Marcar como sucesso para sair do vermelho
                    error_message: null, // Limpar erro
                    status: 'Venda (Recuperada)', // Atualizar status visual
                    // processing_details is not in the schema explicitly seen, let's assume it might not exist or verify.
                    // logLead does NOT write processing_details. It writes sheet_name, sheet_row.
                    // Let's just update what we know exists.
                    sheet_name: insertResult.sheetName,
                    // sheet_row: insertResult.row 
                })
                .eq('id', log.id);

            if (updateError) {
                console.error(`   ❌ Erro ao atualizar log no Supabase:`, updateError);
            } else {
                console.log(`   ✅ Log atualizado no Supabase.`);
                recoveredCount++;
            }

        } else {
            console.error(`   ❌ Falha ao inserir na planilha:`, insertResult.error);
        }
    }

    console.log(`\n🏁 Concluído! Total de vendas recuperadas: ${recoveredCount}`);
}

fixSalesErrors();
