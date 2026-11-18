import assert from 'node:assert/strict';
import fs from 'node:fs';
import {handleExtra} from '../src/extras.js';
const callerId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const calleeId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const chatId='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const callId='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
let storedMode,wasAuto=false,approved=true,notifications=0;
const seen=[];
const env={TC_CALL_ADMIN_EMAIL:'admin@example.net',DB:{prepare(sql){seen.push(sql);
 const obj={
 bind(...args){this.args=args;return this},
 async run(){if(sql.startsWith('INSERT INTO tc_call_modes'))storedMode=this.args[1];if(sql.startsWith('INSERT INTO tc_call_auto_strategies'))wasAuto=true;return {success:true}},
 async first(){
  if(sql.includes('FROM tc_direct_chats WHERE id=?'))return {id:chatId,user_a:callerId,user_b:calleeId};
  if(sql.includes('SELECT state,expires_at FROM tc_remote_call_access'))return approved?{state:'approved',expires_at:null}:null;
  if(sql.includes('SELECT\n    EXISTS(SELECT 1 FROM tc_direct_messages'))return {caller_sent:1,callee_replied:1};
  if(sql.includes('FROM tc_call_sessions WHERE id='))return {id:callId,caller_id:callerId,callee_id:calleeId,status:'ringing'};
  if(sql.includes('SELECT mode FROM tc_call_modes'))return {mode:storedMode};
  if(sql.includes('SELECT call_id FROM tc_call_auto_strategies'))return wasAuto?{call_id:callId}:null;
  if(sql.includes('PRAGMA table_info'))return null;
  throw Error('Unmocked first() query: '+sql.slice(0,90));
 },
 async all(){if(sql.includes('PRAGMA table_info'))return {results:[{name:'expires_at'}]};return {results:[]}}
 };return obj;
}}};
const deps={readJSON:async req=>req.json(),allowOrigin:()=>true,limit:async()=>true,sendPush:()=>{notifications++}};
const alice={id:callerId,email:'user@example.net'};
const bob={id:calleeId,email:'friend@example.net'};
// Auto authorization remains enforced even if user sends a direct API request.
const created=await handleExtra(new Request('https://chat.ege.my.id/api/calls/start',{method:'POST',body:JSON.stringify({conversationId:chatId,kind:'video',mode:'auto'})}),env,alice,{...deps,readJSON:async r=>r.json()});
// Approval may be revoked between opening UI and starting call; tested below using alternative account state.
assert.equal(created.status,200);
assert.equal(storedMode,'remote','Legacy call mode DB constraint remains valid');
assert(wasAuto,'Auto strategy stored independently without altering old database');
assert(seen.some(s=>s.includes('INSERT INTO tc_call_auto_strategies')));
const cfg=await handleExtra(new Request('https://chat.ege.my.id/api/calls/config?callId='+callId),env,bob,deps);
assert.equal(cfg.status,200);
const json=await cfg.json();assert.equal(json.mode,'remote');assert.equal(json.strategy,'auto');
assert.equal(json.turnConfigured,false);
assert.equal(notifications,1);
// Revoked approval must reject a forged AUTO request on the server.
approved=false;
const blocked=await handleExtra(new Request('https://chat.ege.my.id/api/calls/start',{method:'POST',
  body:JSON.stringify({conversationId:chatId,kind:'audio',mode:'auto'})}),env,alice,deps);
assert.equal(blocked.status,403);
assert.equal(notifications,1,'No notification after revoked request');
const html=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
assert(html.includes("c.mode=opts.strategy==='auto'"));
assert(html.includes("iceTransportPolicy:c.mode==='remote'&&opts.turnConfigured?'relay':'all'"));
assert(html.includes("const CALL_MODE_KEY='tc_call_mode_v93'"));
assert(html.includes('preferredCallMode(approved)'));
console.log('PASS V9.3 AUTO: approval mode storage, shared strategy, ICE all policy, old schema safety');
