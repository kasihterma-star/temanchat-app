import assert from 'node:assert/strict';import fs from 'node:fs';
const css=fs.readFileSync('public/v6.css','utf8'),html=fs.readFileSync('public/index.html','utf8'),js=fs.readFileSync('public/app.js','utf8');
assert.match(css,/V9\.9\.5 — responsive navigation/);
assert.match(css,/#messages\{[\s\S]*?overflow-y:auto!important/);
assert.match(css,/--tc-nav-space:calc\(64px/);
assert.match(css,/height:calc\(100dvh - var\(--tc-nav-space\)\)!important/);
assert.match(css,/#modal\.tc-page-view\[open\]/);
assert.match(html,/id="tcNavAccount"/);assert.match(js,/Pesan aktif · V9\.9\.6/);
console.log('PASS V9.9.6 viewport, navbar and scrolling contracts');
