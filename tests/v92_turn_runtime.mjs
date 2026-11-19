import assert from 'node:assert/strict';
import {handleExtra} from '../src/extras.js';

const id='11111111-1111-4111-8111-111111111111';
const me={id:'22222222-2222-4222-8222-222222222222', email:'test@example.net'};
const sqlSeen=[];
const envBase={
 DB:{prepare(sql){sqlSeen.push(sql);return{
  bind(...args){return this},
  async run(){return {success:true}},
  async all(){return {results:[{name:'expires_at'}]}},
  async first(){
   if(sql.includes('FROM tc_call_sessions WHERE id='))return {id,caller_id:me.id,callee_id:'33333333-3333-4333-8333-333333333333',status:'ringing'};
   if(sql.includes('SELECT mode FROM tc_call_modes'))return {mode:'remote'};
   if(sql.includes('SELECT call_id FROM tc_call_auto_strategies'))return null;
   throw new Error('Unexpected SQL first: '+sql.slice(0,60));
  }
 }}},
};
const deps={allowOrigin:()=>true,readJSON:async()=>({}),limit:async()=>true};
const run=async env=>{
 const req=new Request('https://chat.ege.my.id/api/calls/config?callId='+id);
 const response=await handleExtra(req,env,me,deps);
 assert.equal(response.status,200);
 return response.json();
};
const oldFetch=globalThis.fetch;
try{
 let result=await run({...envBase});
 assert.equal(result.mode,'remote');
 assert.equal(result.turnStatus,'not_configured');
 assert.equal(result.turnConfigured,false);
 assert.ok(result.iceServers.every(s=>s.urls.every(u=>u.startsWith('stun:'))));
 globalThis.fetch=async (url,init)=>{
  assert.match(url,/\/credentials\/generate-ice-servers$/);
  assert.equal(init.method,'POST');
  assert.equal(init.headers.Authorization,'Bearer TEST_NOT_EXPOSED');
  assert.equal(JSON.parse(init.body).ttl,21600);
  return Response.json({iceServers:[
   {urls:['stun:stun.cloudflare.com:3478']},
   {urls:['turn:turn.cloudflare.com:3478?transport=udp','turns:turn.cloudflare.com:443?transport=tcp','turn:evil.example:3478?transport=udp'],username:'tempUser',credential:'tempPass'},
  ]},{status:201});
 };
 result=await run({...envBase,CF_TURN_KEY_ID:'valid-key-123',CF_TURN_API_TOKEN:'TEST_NOT_EXPOSED'});
 assert.equal(result.turnStatus,'ready');
 assert.equal(result.turnConfigured,true);
 assert.ok(!JSON.stringify(result).includes('TEST_NOT_EXPOSED'));
 assert.ok(!JSON.stringify(result).includes('evil.example'));
 assert.ok(result.iceServers.some(s=>s.urls.some(u=>u.startsWith('turn:'))));
 globalThis.fetch=async ()=>Response.json({errors:[{message:'denied'}]},{status:401});
 result=await run({...envBase,CF_TURN_KEY_ID:'valid-key-123',CF_TURN_API_TOKEN:'BAD_TOKEN'});
 assert.equal(result.turnConfigured,false);
 assert.equal(result.turnStatus,'unavailable');
 assert.ok(!JSON.stringify(result).includes('BAD_TOKEN'));
 console.log('PASS V9.2 runtime: TURN credentials, URL allowlist, safe fallback and no leaked secret');
}finally{globalThis.fetch=oldFetch}
