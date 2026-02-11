
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function inspectRecovered() {
    console.log('🔍 Buscando leads recuperados...');

    const { data: logs, error } = await supabase
        .from('leads_log')
        .select('*')
        .ilike('status', '%Recuperada%');

    if (error) {
        console.error('❌ Erro:', error);
        return;
    }

    console.log(`📋 Encontrados ${logs.length} logs recuperados:`);
    logs.forEach(log => {
        console.log({
            id: log.id,
            status: log.status,
            event_type: log.event_type,
            processing_result: log.processing_result, // Check this column name!
            result: log.result, // Check if this exists
            details: log.processing_details || log.error_message
        });
    });
}

inspectRecovered();
