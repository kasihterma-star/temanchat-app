// TemanChat WA Pilot — hanya Cloud API resmi, bukan QR WhatsApp Web.
(()=>{
 const $=id=>document.getElementById(id);
 const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n};
 const api=async(path,options={})=>{const r=await fetch(path,{credentials:'same-origin',cache:'no-store',...options});const d=await r.json();if(!r.ok)throw Error(d.error||'Permintaan gagal');return d};
 const send=(path,value)=>api(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
 const state={phone:'',admin:false,allowed:false,configured:false};
 const root=()=>$('modalContent');
 function panel(title,description){const dlg=$('modal');if(dlg.open)dlg.close();dlg.className='tc-page-view tc-wa-page';$('modalTitle').textContent=title;$('modalDesc').textContent=description;root().replaceChildren();dlg.show();dlg.classList.add('tc-glass-enter');return root()}
 function button(label,action,cls='tc-wa-btn'){const b=el('button',cls,label);b.type='button';b.onclick=action;return b}
 function message(text){const p=el('p','tc-wa-note',text);root().prepend(p)}
 async function open(){
  const r=panel('WhatsApp Terhubung','Pilot Meta Cloud API • Nomor tes • Khusus pengguna berizin');r.append(el('p','tc-wa-note','Memeriksa akses WhatsApp…'));
  let s;try{s=await api('/api/wa/status')}catch(e){r.replaceChildren(el('p','tc-wa-note',e.message));return}
  Object.assign(state,s);r.replaceChildren();
  if(!s.allowed){r.append(el('p','tc-wa-note','Akun belum mendapat izin WhatsApp. Minta persetujuan admin TemanChat.'));return}
  if(!s.configured){r.append(el('p','tc-wa-note','Sambungan Meta belum aktif. Admin perlu mengisi 4 Secret di Cloudflare: WA_ACCESS_TOKEN, WA_PHONE_NUMBER_ID, WA_VERIFY_TOKEN, WA_APP_SECRET serta daftar nomor tes WA_TEST_RECIPIENTS. Lihat panduan dalam ZIP.'))}
  if(s.admin){
   r.append(button('Kelola izin pengguna',()=>void users()));
   const testForm=el('form','tc-wa-compose'),label=el('label','', 'Kirim template tes pertama (hello_world)'),number=el('input');
   number.type='tel';number.inputMode='numeric';number.placeholder='628xxxxxxxxxx (tanpa +)';number.maxLength=15;
   const go=el('button','tc-wa-btn','Kirim template tes via Meta');go.type='submit';
   testForm.append(label,number,go);testForm.onsubmit=async e=>{e.preventDefault();go.disabled=true;try{await send('/api/wa/test-template',{to:number.value.trim()});message('Template hello_world terkirim. Balas pesan tersebut dari WhatsApp penerima, kemudian tekan Muat ulang percakapan.')}catch(err){message(err.message)}finally{go.disabled=false}};
   r.append(testForm);
  }
  const controls=el('div','tc-wa-tools');
  controls.append(button('Muat ulang percakapan',()=>void conversations()));
  r.append(controls,el('div','tc-wa-conversations'));
  await conversations();
 }
 async function conversations(){
  const r=document.querySelector('.tc-wa-conversations');if(!r)return;
  r.replaceChildren(el('p','tc-wa-note','Memuat nomor WhatsApp…'));
  try{const d=await api('/api/wa/conversations');r.replaceChildren();
   if(!d.conversations.length)r.append(el('p','tc-wa-note','Belum ada pesan masuk. Untuk memulai percobaan, kirim template hello_world dari dashboard Meta ke nomor penerima yang sudah terverifikasi. Setelah penerima membalas, percakapannya muncul di sini.'));
   for(const c of d.conversations){const b=button('+'+c.phone+' · '+(c.preview||'Lihat pesan'),()=>void chat(c.phone));r.append(b)}
  }catch(e){r.replaceChildren(el('p','tc-wa-note',e.message))}
 }
 async function chat(phone){if(!/^\d{8,15}$/.test(phone))return;state.phone=phone;
  const r=panel('WA: +'+phone,'Percakapan nomor tes Meta • Layanan chat teks');
  r.append(button('← Kembali',()=>void open()));
  const list=el('div','tc-wa-history');r.append(list);
  const form=el('form','tc-wa-compose'),input=el('textarea');input.rows=2;input.maxLength=1000;input.placeholder='Balas pesan WhatsApp…';input.required=true;
  const b=el('button','tc-wa-btn','Kirim balasan');b.type='submit';form.append(input,b);r.append(form);
  async function refresh(){list.replaceChildren(el('p','tc-wa-note','Memuat pesan…'));try{const d=await api('/api/wa/messages?phone='+encodeURIComponent(phone));list.replaceChildren();for(const m of d.messages){const bubble=el('div','tc-wa-bubble '+(m.direction==='out'?'out':'in'));bubble.append(el('small','',m.direction==='out'?'TemanChat':'WhatsApp'));bubble.append(el('p','',m.body));list.append(bubble)}}catch(e){list.replaceChildren(el('p','tc-wa-note',e.message))}}
  form.onsubmit=async e=>{e.preventDefault();b.disabled=true;try{await send('/api/wa/send',{to:phone,text:input.value});input.value='';await refresh()}catch(error){list.append(el('p','tc-wa-note',error.message))}finally{b.disabled=false}};
  await refresh();
 }
 async function users(){const r=panel('Izin WhatsApp','Admin dapat memberikan atau mencabut akses ke panel WhatsApp.');r.append(button('← Kembali',()=>void open()));const list=el('div','tc-wa-users');r.append(list);
  try{const d=await api('/api/wa/users');for(const u of d.users){const row=el('div','tc-wa-user'),name=el('span','',u.display_name+' (@'+u.username+')'),toggle=button(u.enabled?'Cabut izin':'Beri izin',async()=>{toggle.disabled=true;try{await send('/api/wa/users',{userId:u.id,enabled:!Boolean(u.enabled)});u.enabled=u.enabled?0:1;toggle.textContent=u.enabled?'Cabut izin':'Beri izin'}catch(e){alert(e.message)}finally{toggle.disabled=false}});row.append(name,toggle);list.append(row)}}catch(e){r.append(el('p','tc-wa-note',e.message))}
 }
 window.TCWhatsApp={open};
})();
