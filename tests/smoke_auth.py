"""UI regression test for registration success (mocked Turnstile/API)."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import re
base=Path(__file__).resolve().parents[1]
html=(base/'public/auth.html').read_text()
css=re.sub(r'^@import url\(.*?\);','',(base/'public/auth.css').read_text(),flags=re.S)
html=re.sub(r'<link[^>]+href="/auth\.css\?v=6\.0"[^>]*>','<style>'+css+'</style>',html)
html=re.sub(r'<script[^>]+src="https://challenges\.cloudflare\.com/[^>]+></script>','',html)
html=re.sub(r'<script[^>]+src="/auth\.js\?v=6\.0"[^>]*></script>','',html)
mock='''
window.turnstile={render:(_id,o)=>{setTimeout(()=>o.callback('test-token'),40);window.__TURN=o;return 1},getResponse:()=>"test-token",reset:()=>setTimeout(()=>window.__TURN.callback("test-token"),30)};
window.fetch=async (url,opts={})=>{let d={ok:true};if(url.includes('config'))d={siteKey:'test',authReady:true};else if(url.includes('register'))d={ok:true,message:'Registrasi berhasil'};return new Response(JSON.stringify(d),{status:200,headers:{'Content-Type':'application/json'}})};
'''
html=html.replace('</head>','<script>'+mock+'</script></head>')
html=html.replace('</body>','<script>'+(base/'public/auth.js').read_text()+'</script></body>')
with sync_playwright() as pw:
 browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
 p=browser.new_page(viewport={'width':390,'height':840})
 errors=[];p.on('pageerror',lambda e:errors.append(str(e)))
 p.set_content(html)
 p.get_by_role('button',name='Daftar',exact=True).click()
 p.locator('#displayName').fill('Pengguna Uji')
 p.locator('#username').fill('pengujitemanchat')
 p.locator('#email').fill('uji@example.com')
 p.locator('#password').fill('contoh8Huruf!')
 p.locator('#submitBtn').click()
 p.get_by_text('Pendaftaran berhasil!').wait_for(timeout=5000)
 assert p.get_by_text('uji@example.com').is_visible()
 assert p.locator('#authForm').is_hidden()
 p.get_by_role('button',name='Kembali ke Login').click()
 assert p.locator('#authForm').is_visible()
 assert not errors,errors
 print('PASS AUTH: 8+ karakter, notifikasi verifikasi, kembali login')
 browser.close()
