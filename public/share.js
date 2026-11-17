// TemanChat V8.5: berbagi tautan publik, tidak pernah membagikan sesi, kontak, atau token.
(()=>{
 'use strict';
 const URL_PUBLIC='https://chat.ege.my.id/';
 const SHARE_TEXT='Yuk ngobrol dan telepon lewat TemanChat!';
 const msg=SHARE_TEXT+' '+URL_PUBLIC;
 const wa='https://wa.me/?text='+encodeURIComponent(msg);
 const tg='https://t.me/share/url?url='+encodeURIComponent(URL_PUBLIC)+'&text='+encodeURIComponent(SHARE_TEXT);
 const mail='mailto:?subject='+encodeURIComponent('Undangan TemanChat')+'&body='+encodeURIComponent(msg);
 let dialog;
 function addLink(container,label,url){
  const a=document.createElement('a');a.className='tc-share-option';a.textContent=label;
  a.href=url;if(!url.startsWith('mailto:')){a.target='_blank';a.rel='noopener noreferrer';}
  container.append(a);return a;
 }
 async function copyLink(){
  try{
   if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(URL_PUBLIC);
   else{
    const t=document.createElement('textarea');t.value=URL_PUBLIC;t.setAttribute('readonly','');t.style.position='fixed';t.style.opacity='0';document.body.append(t);t.select();
    const copied=document.execCommand('copy');t.remove();if(!copied)throw Error('Clipboard tidak tersedia');
   }
   const status=dialog?.querySelector('.tc-share-status');if(status)status.textContent='Tautan berhasil disalin.';
  }catch{
   // Manual copy juga berfungsi di browser iOS yang memblokir clipboard.
   const status=dialog?.querySelector('.tc-share-status');
   if(status){status.textContent='Salin tautan ini secara manual:';const input=document.createElement('input');input.readOnly=true;input.value=URL_PUBLIC;status.append(input);input.focus();input.select();}
  }
 }
 function fallback(){
  if(!dialog){
   dialog=document.createElement('dialog');dialog.className='tc-share-dialog';dialog.setAttribute('aria-label','Bagikan TemanChat');
   const title=document.createElement('h2');title.textContent='Bagikan TemanChat';
   const info=document.createElement('p');info.textContent='Ajak teman membuka TemanChat lewat browser atau memasangnya di HP.';
   const options=document.createElement('div');options.className='tc-share-options';
   addLink(options,'WhatsApp',wa);addLink(options,'Telegram',tg);addLink(options,'Email',mail);
   const copy=document.createElement('button');copy.type='button';copy.className='tc-share-option';copy.textContent='Salin tautan';copy.addEventListener('click',copyLink);options.append(copy);
   const status=document.createElement('div');status.className='tc-share-status';status.setAttribute('role','status');
   const close=document.createElement('button');close.type='button';close.className='tc-share-close';close.textContent='Tutup';close.addEventListener('click',()=>dialog.close());
   dialog.append(title,info,options,status,close);document.body.append(dialog);
  }
  if(!dialog.open)dialog.showModal();
 }
 async function open(){
  // Harus dipanggil langsung dari klik/tap, agar Web Share API diizinkan browser.
  if(typeof navigator.share==='function'){
   try{await navigator.share({title:'TemanChat',text:SHARE_TEXT,url:URL_PUBLIC});return;}
   catch(e){if(e?.name==='AbortError')return;}
  }
  fallback();
 }
 window.TCShare={open};
 document.addEventListener('DOMContentLoaded',()=>{
  for(const id of ['shareAppBtn','shareAuthBtn']){
   const b=document.getElementById(id);if(b)b.addEventListener('click',open);
  }
 });
})();
