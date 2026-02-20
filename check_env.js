require('dotenv').config();

// WARNING: Production Connection
console.log('\x1b[31m%s\x1b[0m', '================================================================');
console.log('\x1b[31m%s\x1b[0m', '⚠️  WARNING: You are running locally but connected to REMOTE PRODUCTION DATABASE via Tunnel!');
console.log('\x1b[33m%s\x1b[0m', '⚠️  ANY CHANGES WILL AFFECT REAL DATA!');
console.log('\x1b[31m%s\x1b[0m', '================================================================');

console.log('DATABASE_URL:', process.env.DATABASE_URL ? 'Configured (Remote Tunnel)' : 'MISSING');
