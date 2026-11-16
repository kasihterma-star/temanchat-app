import assert from 'node:assert/strict';
import fs from 'node:fs';
import {pushApi,sendPush} from '../src/push.js';
const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../public/v6.css',import.meta.url),'utf8');
const sw=fs.readFileSync(new URL('../public/sw.js',import.meta.url),'utf8');
assert.match(app,/NOTIFY_PREF='tc_notifications_enabled'/);
assert.match(app,/localStorage\.setItem\(NOTIFY_PREF,'off'\);stopCallTone\(\)/);
assert.match(app,/notificationsEnabled\(\)\&\&!serverPushEnabled/);
assert.match(app,/const visibleChatId/);
assert.match(app,/pagehide',leaveNotificationFocus/);
assert.match(app,/touchstart/);assert.match(app,/touchmove/);assert.match(app,/touchend/);
assert.match(app,/distance>=62/);assert.match(css,/\.tc-swipe-reply-icon/);
assert.match(css,/\.tc-voice-wave/);assert.match(html,/class="tc-voice-wave"/);
<<<<<<< HEAD
assert.match(app,/tc-audio-shell/);assert.match(sw,/temanchat-v76-photo-reply/);
=======
assert.match(app,/tc-audio-shell/);assert.match(sw,/temanchat-v75-smart-voice/);
>>>>>>> ab2fb14b2bbe2c86d1fd2149a08eecedb51f74f3
// D1 mock: verifies authorized focus, authorization failure and skip for active chat.
const user='u1',chat='11111111-1111-4111-8111-111111111111',endpoint='https://fcm.googleapis.com/fcm/send/test';
const trace=[],mock={
 prepare(sql){
   const call={
     bind(...params){this.params=params;return this},
     async run(){trace.push({sql,params:this.params||[]});return {success:true}},
     async first(){
       trace.push({sql,params:this.params||[]});
       if(sql.includes('SELECT id FROM tc_push_subscriptions'))return this.params[1]===user?{id:'subscription1'}:null;
       if(sql.includes('SELECT id FROM tc_direct_chats'))return this.params[1]===user&&this.params[0]===chat?{id:chat}:null;
       if(sql.includes('SELECT 1 FROM tc_push_focus'))return this.params[1]===chat?{ok:1}:null;
       return null;
     },
     async all(){trace.push({sql,params:this.params||[]});return {results:[]}}
   };
   return call;
 }
};
const env={DB:mock,VAPID_PRIVATE_KEY:'dummy-private',VAPID_PUBLIC_KEY:'dummy-public'};
function request(body){return new Request('https://chat.ege.my.id/api/push/active-chat',{method:'POST',headers:{Origin:'https://chat.ege.my.id','Content-Type':'application/json'},body:JSON.stringify(body)})}
const okay=await pushApi(request({endpoint,active:true,conversationId:chat}),env,{id:user});
assert.equal(okay.status,200);
assert.equal((await okay.json()).active,true);
assert(trace.some(x=>x.sql.includes('INSERT INTO tc_push_focus')));
const unauthorized=await pushApi(request({endpoint,active:true,conversationId:chat}),env,{id:'u2'});
assert.equal(unauthorized.status,404);
const foreignChat=await pushApi(request({endpoint,active:true,conversationId:'22222222-2222-4222-8222-222222222222'}),env,{id:user});
assert.equal(foreignChat.status,403);
trace.length=0;
await sendPush(env,user,{kind:'message',conversationId:chat,title:'Test',body:'a'});
assert(trace.some(x=>x.sql.includes('SELECT 1 FROM tc_push_focus')));
assert(!trace.some(x=>x.sql.includes('SELECT id,endpoint,p256dh,auth FROM tc_push_subscriptions')),'should mute active same-chat push');
trace.length=0;
await sendPush(env,user,{kind:'message',conversationId:'22222222-2222-4222-8222-222222222222',title:'Chat berbeda'});
assert(trace.some(x=>x.sql.includes('SELECT id,endpoint,p256dh,auth FROM tc_push_subscriptions')),'other chats still notify');
trace.length=0;
await sendPush(env,user,{kind:'call',callId:'cid',title:'Call'});
assert(trace.some(x=>x.sql.includes('SELECT id,endpoint,p256dh,auth FROM tc_push_subscriptions')),'calls must not be muted by chat focus');
const cleared=await pushApi(request({endpoint,active:false}),env,{id:user});
assert.equal(cleared.status,200);
assert(trace.some(x=>x.sql.includes('DELETE FROM tc_push_focus')));
console.log('PASS V7.5: focus guard, same-chat mute, other notifications, global OFF guards, touch swipe, voice UI');
