import assert from 'node:assert/strict';
import fs from 'node:fs';
const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const sw=fs.readFileSync(new URL('../public/sw.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
assert.match(app,/silent:mode==='silent'/);
assert.match(sw,/silent:notificationMode==='silent'/);
assert.match(sw,/\['both','vibrate'\]\.includes\(notificationMode\)/);
assert.match(app,/\$\('backBtn'\)\.onclick=showList/);
assert.doesNotMatch(app,/history\.pushState\(/);
assert.doesNotMatch(app,/addEventListener\('popstate'/);
<<<<<<< HEAD
assert.match(html,/v=9\.1\.0/);
=======
assert.match(html,/v=9\.0\.0/);
>>>>>>> e22bf38bc68cb1d58b392fb40484ca1565020f94
console.log('PASS V7.9: notification options valid, back button independent, cache updated');
