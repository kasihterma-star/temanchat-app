import assert from 'node:assert/strict';import fs from 'node:fs';
const app=fs.readFileSync('public/app.js','utf8');const sw=fs.readFileSync('public/sw.js','utf8');
assert.match(app,/tcCanApplyUpdate/);assert.match(app,/!currentCall/);assert.match(app,/messageInput/);assert.match(app,/reg\.update\(\)/);assert.match(app,/controllerchange/);assert.match(app,/tcHadControllerAtLoad/);
assert.match(sw,/pushsubscriptionchange/);assert.match(sw,/\/api\/push\/subscribe/);assert.match(sw,/temanchat-v994-four-tabs/);
assert.match(app,/Pesan aktif · V9\.9\.4/);console.log('PASS V9.9.4 safe updates and push renewal');
