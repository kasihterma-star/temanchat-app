// Gate halaman demo, bukan pengganti pemeriksaan otorisasi API di server.
fetch('/api/auth/me',{credentials:'same-origin',cache:'no-store'})
 .then(async r=>{if(!r.ok){location.replace('/auth.html');return}const d=await r.json();if(!d.ok){location.replace('/auth.html');return}
 document.documentElement.classList.add('tc-auth-ready');
 const profile=document.querySelector('.profile b');if(profile)profile.textContent=d.user.display_name||'Saya';
 })
 .catch(()=>{location.replace('/auth.html?error=network')});
