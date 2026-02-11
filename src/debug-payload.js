require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function getLatestPayload() {
    console.log('🔍 Buscando último payload bruto do webhook...');

    const { data, error } = await supabase
        .from('webhook_events')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

    if (error) {
        console.error('❌ Erro:', error);
        return;
    }

    console.log('📦 Último Payload Recebido:');
    console.log(JSON.stringify(data.payload, null, 2));
}

getLatestPayload();
