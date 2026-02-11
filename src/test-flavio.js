const { normalizeTintimPayload } = require('./utils/validator');

const payload = {
    "account": {
        "code": "11e6d325-8435-4afc-b2e5-91aa0110678f",
        "name": "Lucas Raydan Advogados"
    },
    "created_isoformat": "2026-02-11T00:10:52.368022-03:00",
    "event_type": "lead.create",
    "name": "Flavio",
    "phone": "5573982428880"
};

console.log('--- Payload Original ---');
console.log(JSON.stringify(payload, null, 2));

const normalized = normalizeTintimPayload(payload);

console.log('\n--- Payload Normalizado ---');
console.log('chatName:', normalized.chatName);
console.log('senderName:', normalized.senderName);
console.log('name:', normalized.name);
console.log('account.name:', normalized.account.name);
