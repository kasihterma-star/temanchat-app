import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const html=readFileSync('public/index.html','utf8');const js=readFileSync('public/app.js','utf8');const css=readFileSync('public/v6.css','utf8');
assert.equal((html.match(/id="settingsBtn"/g)||[]).length,1,'only one settings button in DOM');
assert.match(html,/<div class="sidebar-title"><h2>Pesan<\/h2><div class="profile">/);
assert.match(js,/dlg\.showModal\(\);/,'settings page must enter top layer');
assert.doesNotMatch(js,/if\(page\)dlg\.show\(\)/);
assert.match(js,/tcAccountProfile\.onclick/);
assert.match(css,/\.sidebar-title \.profile #settingsBtn\{display:none!important\}/);
console.log('PASS V9.8 settings navigation and profile single entry');
