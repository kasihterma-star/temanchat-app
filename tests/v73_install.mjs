import fs from 'node:fs';import assert from 'node:assert/strict';
const html=fs.readFileSync('public/index.html','utf8'),js=fs.readFileSync('public/app.js','utf8'),css=fs.readFileSync('public/v6.css','utf8'),sw=fs.readFileSync('public/sw.js','utf8');
for(const id of ['installBanner','installBannerAction','installBannerDismiss','installBtn'])assert.ok(html.includes(`id="${id}"`),id);
for(const term of ['runningAsApp','navigator.standalone','display-mode: standalone','beforeinstallprompt','appinstalled','INSTALL_SNOOZE_KEY','triggerTemanChatInstall'])assert.ok(js.includes(term),term);
assert.ok(js.includes("$('installBtn').hidden=installed"));
assert.ok(js.includes('setTimeout(refreshInstallOffer,1300)'));
assert.ok(css.includes('.tc-install-banner'));
<<<<<<< HEAD
assert.ok(sw.includes('temanchat-v91-call-mode-display'));
=======
assert.ok(sw.includes('temanchat-v90-admin-panel'));
>>>>>>> e22bf38bc68cb1d58b392fb40484ca1565020f94
assert.ok(!html.includes('v=7.2.0'));
console.log('V7.3 install controls OK');
