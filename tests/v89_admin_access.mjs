import assert from 'node:assert/strict';
import fs from 'node:fs';
const api=fs.readFileSync('src/extras.js','utf8');
const ui=fs.readFileSync('public/app.js','utf8');
const sw=fs.readFileSync('public/sw.js','utf8');
assert.match(api,/ALTER TABLE tc_remote_call_access ADD COLUMN expires_at TEXT/);
assert.match(api,/r\.expires_at/);
assert.match(api,/adminCalls=1/);
assert.match(api,/call_access_request/);
assert.match(api,/call_access_result/);
assert.match(api,/remoteApproved\(env,me\)/);
assert.match(api,/durationSql/);
assert.match(api,/d\.state==='approved'&&duration!=='forever'/);
assert.match(api,/mode==='remote'&&!await remoteApproved\(env,me\)/);
assert.match(ui,/\['1d','1 hari'\]/);
assert.match(ui,/\['7d','7 hari'\]/);
assert.match(ui,/\['30d','30 hari'\]/);
assert.match(ui,/\['forever','Tanpa batas waktu'\]/);
assert.match(ui,/adminCalls/);
<<<<<<< HEAD
assert.match(sw,/temanchat-v91-call-mode-display/);
=======
assert.match(sw,/temanchat-v90-admin-panel/);
>>>>>>> e22bf38bc68cb1d58b392fb40484ca1565020f94
console.log('PASS V8.9: server permissions, expiring grants, admin push and UI');
