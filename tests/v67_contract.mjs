import fs from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
const get=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sw=get('public/sw.js'),worker=get('src/index.js'),ui=get('public/app.js'),css=get('public/v6.css');
assert(worker.includes("'/api/chat/push-delivered'"));
assert(worker.includes('m.sender_id<>?'), 'delivery proof must check recipient');
assert(worker.includes('unreadCount:Number(badgeRow?.n||0)'));
assert(worker.includes("Math.floor(now/60000),100"));
assert(worker.includes("Math.floor(now/60000),50"));
assert(ui.includes('await sub.unsubscribe()'));
assert(ui.includes('input.focus({preventScroll:true})'));
assert(ui.includes('startCallTone(incoming?'));
assert(css.includes('backdrop-filter:blur'));
// Simulate service-worker push; assert that the ACK goes to the correct authenticated route.
const events=new Map(),requests=[];let notices=0,badges=[];
const self={registration:{showNotification:async()=>{notices++},setAppBadge:async n=>badges.push(n)},clients:{claim(){}} ,addEventListener:(n,cb)=>events.set(n,cb)};
const context={self,location:{origin:'https://chat.ege.my.id'},URL,console,JSON,Promise,Number,String,
 caches:{},fetch:async(url,opts)=>{requests.push({url,opts});return{ok:true,status:200}}};
vm.runInNewContext(sw,context);
const waits=[];
events.get('push')({data:{json(){return{kind:'message',conversationId:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',messageId:42,unreadCount:3,url:'/?chat=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',title:'TemanChat'}}},waitUntil(p){waits.push(p)}});
await Promise.all(waits);
assert.equal(requests.length,1);assert.equal(requests[0].url,'/api/chat/push-delivered');
assert.equal(requests[0].opts.credentials,'same-origin');
assert.equal(JSON.parse(requests[0].opts.body).messageId,42);
assert.deepEqual(badges,[3]);assert.equal(notices,1);
console.log('PASS V6.7: ACK requires authenticated server request; badge and notification on push.');
