"""UI smoke using local inline assets and mocked API (offline)."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import re,json
BASE=Path(__file__).resolve().parents[1]
html=(BASE/'public/index.html').read_text()
for filename in ('style.css','v6.css'):
 html=re.sub(r'<link[^>]+href="/'+re.escape(filename)+r'\?v=6\.0"[^>]*>', lambda m:'<style>'+re.sub(r'^@import url\(.*?\);', '', (BASE/'public'/filename).read_text(),count=1,flags=re.S)+'</style>',html)
inlines=''
for filename in ('config.js','storage.js','app.js'):
 html=re.sub(r'<script[^>]+src="/'+re.escape(filename)+r'\?v=6\.0"[^>]*></script>','',html)
 inlines += '<script>'+(BASE/'public'/filename).read_text()+'</script>'
html=html.replace('</body>',inlines+'</body>')
# Mock API as if requests went to Cloudflare; no personal credentials/network.
mock='''
window.__MESSAGES=[];
window.fetch=async (url,opts={})=>{
 const u=new URL(url,'https://chat.ege.my.id');let data={ok:true};
 if(u.pathname==='/api/auth/me')data.user={id:'me1',username:'penguji1',display_name:'Penguji Satu',email_verified:1};
 if(u.pathname==='/api/media/config')data.enabled=false;
 if(u.pathname==='/api/chat/conversations')data.conversations=[{id:'00000000-0000-4000-8000-000000000001',other_username:'teman2',other_name:'Teman Dua',last_message:'',last_time:''}];
 if(u.pathname==='/api/chat/people')data.people=[{username:'teman2',display_name:'Teman Dua'}];
 if(u.pathname==='/api/chat/start')data.conversationId='00000000-0000-4000-8000-000000000001';
 if(u.pathname==='/api/chat/messages')data.messages=window.__MESSAGES;
 if(u.pathname==='/api/chat/send'){const input=JSON.parse(opts.body);const m={id:window.__MESSAGES.length+1,body:input.body,sender_id:'me1',created_at:'2026-11-11 09:00:00'};window.__MESSAGES.push(m);data.message=m}
 if(u.pathname==='/api/calls/incoming')data.call=null;
 return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
};
'''
html=html.replace('</head>','<script>'+mock+'</script></head>')
with sync_playwright() as pw:
 browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
 for width in (390,1280):
  print('START',width,flush=True)
  page=browser.new_page(viewport={'width':width,'height':844})
  errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.set_content(html,wait_until='domcontentloaded')
  
  try: page.wait_for_function("document.querySelector('.profile b')?.textContent === 'Penguji Satu'",timeout=8000)
  except Exception as e:
   print('DEBUG', errors, page.evaluate('typeof window.TCStorage'), page.locator('.profile b').text_content(), page.evaluate('document.scripts.length'))
   raise
  page.locator('#search').fill('teman2')
  page.locator('.contact').first.click()
  page.wait_for_function("document.getElementById('headName')?.textContent === 'Teman Dua'",timeout=8000)
  if width==390:
   assert page.locator('#conversation').is_visible(), 'Percakapan harus terlihat di HP'
   assert not page.locator('#sidebar').is_visible(), 'Sidebar tidak boleh menutupi percakapan'
  page.locator('#messageInput').fill('Halo dari uji otomatis')
  page.locator('#messageForm .send').click()
  page.wait_for_function("document.querySelectorAll('.bubble').length > 0",timeout=8000)
  if width==390:
   page.locator('#backBtn').click()
   assert page.locator('#sidebar').is_visible(), 'Tombol kembali harus berfungsi'
  assert not errors, f'Error Javascript ukuran {width}: {errors}'
  print('SCREENSHOT',width,flush=True)
  page.screenshot(path=str(BASE/'tests'/f'preview_{width}.png'),timeout=10000,animations='disabled')
  print('PASS UI',width,'px: cari, buka chat, kirim pesan, kembali')
  page.close(run_before_unload=False)
 browser.close()
