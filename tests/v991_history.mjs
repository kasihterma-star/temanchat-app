import assert from 'node:assert/strict';import fs from 'node:fs';
const app=fs.readFileSync('public/app.js','utf8');
assert.match(app,/async function showCallHistory\(\)/);
assert.match(app,/Array\.isArray\(data\?\.calls\)/);
assert.match(app,/Riwayat belum bisa dimuat/);
assert.match(app,/Coba lagi/);
assert.match(app,/requestId===callHistoryRequestId/);
assert.match(app,/\$\('tcNavCalls'\)\.onclick/);
console.log('PASS V9.9.1 resilient call history');
