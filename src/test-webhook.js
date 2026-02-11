/**
 * Teste — Simula webhook REAL do Tintim (formato lead.create)
 * 
 * Este teste usa o formato IDÊNTICO ao que o Tintim envia de verdade,
 * não o formato simplificado que os testes antigos usavam.
 */
const http = require('http');

// Payload REAL do Tintim (copiado do evento que falhou)
const realPayload = {
    account: {
        code: "11e6d325-8435-4afc-b2e5-91aa0110678f",
        name: "Lucas Raydan Advogados"
    },
    accumulated_value: 0.0,
    ad: null,
    created: "2026-02-10 às 23:20:21",
    created_isoformat: "2026-02-10T23:20:21.611871-03:00",
    ctwa_clid: null,
    event_type: "lead.create",
    first_interaction_at: "2026-02-10T23:20:21-03:00",
    last_interaction_at: "2026-02-10T23:20:21-03:00",
    location: {
        country: "Brazil",
        state: "São Paulo"
    },
    name: null,
    phone: "5511992083378",
    phone_e164: "+5511992083378",
    sale_amount: 0.0,
    sale_amount_from_message: 0.0,
    source: "Não rastreada",
    status: {
        id: 69783,
        name: "Fez Contato"
    },
    total_messages: 0,
    updated: "2026-02-10 às 23:20:21",
    updated_isoformat: "2026-02-10T23:20:21.618340-03:00",
    visit: null
};

const data = JSON.stringify(realPayload);

const options = {
    hostname: 'localhost',
    port: 3000,
    path: '/webhook/tintim',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
    },
};

console.log('\n🧪 Simulando PAYLOAD REAL do Tintim...');
console.log('📌 event_type:', realPayload.event_type);
console.log('📌 account.code:', realPayload.account.code);
console.log('📌 phone:', realPayload.phone);
console.log('📌 name:', realPayload.name);
console.log('📌 status:', realPayload.status.name);
console.log('---');

const req = http.request(options, (res) => {
    console.log('\n✅ Resposta HTTP:', res.statusCode);
    if (res.statusCode === 200) {
        console.log('Aceito! Verifique os logs do servidor e a planilha.');
        console.log('\nCampos que o app deve ter normalizado:');
        console.log('  instanceId ← account.code = ' + realPayload.account.code);
        console.log('  moment ← created_isoformat = ' + realPayload.created_isoformat);
        console.log('  chatName ← name || account.name = ' + (realPayload.name || realPayload.account.name));
    } else {
        console.log('❌ Resposta inesperada. Verifique os logs.');
    }
});

req.on('error', (e) => {
    console.error('❌ Erro de conexão:', e.message);
});

req.write(data);
req.end();
