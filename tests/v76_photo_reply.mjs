import assert from 'node:assert/strict';
import fs from 'node:fs';
const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../public/v6.css',import.meta.url),'utf8');
const sw=fs.readFileSync(new URL('../public/sw.js',import.meta.url),'utf8');
for(const id of ['photoPreviewDialog','photoPreviewImage','photoMirrorToggle','photoPreviewCancel','photoPreviewSend'])
 assert.ok(html.includes(`id="${id}"`),`Missing ${id}`);
assert.match(app,/async function previewPhotoBeforeSend\(file\)/);
assert.match(app,/if\(!file\)return; \/\/ Batal tidak pernah mengunggah/);
assert.match(app,/if\(!mirrored\)return finish\(file\)/);
assert.match(app,/ctx\.scale\(-1,1\)/);
assert.match(app,/new File\(\[blob\]/);
assert.match(css,/\.tc-photo-preview-frame img/);
assert.match(css,/#messages \.bubble\{max-width:min\(83%/);
assert.match(sw,/temanchat-v84-turn-drive/);
console.log('PASS V7.6: photo modal, manual mirror, cancel guard, reply viewport and cache');
