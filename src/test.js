/**
 * Teste — Simula webhook do Tintim para o Raydan
 */
const http = require('http');

const testPayload = {
    phone: "5533988836450",
    fromMe: false,
    moment: new Date().toISOString(),
    chatName: "TESTE AUTOMACAO",
    messageId: "TEST_" + Date.now(),
    instanceId: "11e6d325-8435-4afc-b2e5-91aa0110678f",
    senderName: "Lucas Raydan Advogados",
    original_data: {},
    text: {
        message: "Ola, quero saber sobre BPC LOAS"
    }
};

const data = JSON.stringify(testPayload);

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

console.log('\nSimulando lead do Tintim para Raydan...');
console.log('Telefone: ' + testPayload.phone);
console.log('Nome: ' + testPayload.chatName);
console.log('Instance: ' + testPayload.instanceId);

const req = http.request(options, (res) => {
    console.log('\nResposta: ' + res.statusCode);
    if (res.statusCode === 200) {
        console.log('Aceito! Verifique a planilha e os logs do servidor.');
    } else {
        console.log('Resposta inesperada. Verifique os logs.');
    }
});

req.on('error', (e) => {
    console.error('Erro: ' + e.message);
});

req.write(data);
req.end();
