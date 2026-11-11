
'use strict';

const $ = id => document.getElementById(id);

let mode = 'login';
let widgetId = null;
let siteKey = null;
let submitting = false;
let turnstileReady = false;
let registrationComplete = false;

const params = new URLSearchParams(location.search);

function notice(message, error = false) {
  const n = $('notice');
  n.hidden = false;
  n.textContent = message;
  n.classList.toggle('error', error);
}

function switchMode(next) {
  mode = next;
  registrationComplete = false;

  const success = document.getElementById('registerSuccess');
  if (success) success.remove();

  $('authForm').hidden = false;

  $('registerFields').hidden = mode !== 'register';
  $('passwordGroup').hidden =
    ['forgot', 'resend'].includes(mode);
  $('emailGroup').hidden = mode === 'reset';
  $('tabs').hidden =
    !['login', 'register'].includes(mode);

  for (const b of $('tabs').querySelectorAll('button')) {
    b.classList.toggle('on', b.dataset.mode === mode);
  }

  $('email').required = mode !== 'reset';
  $('password').required =
    !['forgot', 'resend'].includes(mode);
  $('displayName').required = mode === 'register';
  $('username').required = mode === 'register';

  $('passwordLabel').textContent =
    mode === 'reset' ? 'Password baru' : 'Password';

  $('password').autocomplete =
    mode === 'login'
      ? 'current-password'
      : 'new-password';

  $('submitBtn').textContent = ({
    login: 'Masuk',
    register: 'Daftar akun',
    forgot: 'Kirim link reset',
    resend: 'Kirim ulang verifikasi',
    reset: 'Ganti password'
  })[mode];

  $('forgotBtn').hidden =
    ['forgot', 'resend', 'reset'].includes(mode);

  $('resendBtn').hidden =
    ['forgot', 'resend', 'reset'].includes(mode);

  $('notice').hidden = true;

  turnstileReady = false;
  $('submitBtn').disabled = true;

  if (widgetId !== null && window.turnstile) {
    window.turnstile.reset(widgetId);
  }
}

function showRegistrationSuccess(email) {
  registrationComplete = true;

  $('notice').hidden = true;
  $('authForm').hidden = true;
  $('tabs').hidden = true;

  const old = document.getElementById('registerSuccess');
  if (old) old.remove();

  const panel = document.createElement('section');
  panel.id = 'registerSuccess';

  panel.style.cssText = `
    text-align:center;
    padding:24px 10px;
    display:flex;
    flex-direction:column;
    align-items:center;
    gap:14px;
  `;

  const icon = document.createElement('div');
  icon.textContent = '✉';
  icon.style.cssText = `
    width:64px;
    height:64px;
    border-radius:50%;
    background:#d9f5e9;
    color:#087c68;
    display:grid;
    place-items:center;
    font-size:30px;
  `;

  const title = document.createElement('h2');
  title.textContent = 'Pendaftaran Berhasil!';
  title.style.cssText = `
    margin:0;
    color:#075f52;
    font-size:22px;
  `;

  const description = document.createElement('p');
  description.textContent =
    'Kami telah mengirimkan tautan verifikasi ke:';
  description.style.cssText = `
    margin:0;
    line-height:1.6;
    color:#526b66;
  `;

  const address = document.createElement('strong');
  address.textContent = email;
  address.style.cssText = `
    overflow-wrap:anywhere;
    color:#075f52;
  `;

  const instruction = document.createElement('p');
  instruction.textContent =
    'Silakan buka email dan klik tautan verifikasi untuk mengaktifkan akun. Jika tidak ditemukan, periksa folder Spam. Tautan berlaku 30 menit.';
  instruction.style.cssText = `
    margin:0;
    line-height:1.7;
    color:#526b66;
  `;

  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Kembali ke Login';
  button.style.cssText = `
    width:100%;
    background:#078575;
    color:white;
    padding:14px;
    border:none;
    border-radius:12px;
    font-weight:700;
    cursor:pointer;
    margin-top:10px;
  `;

  button.onclick = () => {
    switchMode('login');
    $('password').value = '';
  };

  panel.append(
    icon,
    title,
    description,
    address,
    instruction,
    button
  );

  $('authForm').insertAdjacentElement('afterend', panel);
}

$('tabs').addEventListener('click', e => {
  const next = e.target.closest('button')?.dataset.mode;
  if (next) switchMode(next);
});

$('forgotBtn').onclick = () => switchMode('forgot');

$('resendBtn').onclick = () => switchMode('resend');

$('showPassword').onclick = () => {
  const p = $('password');

  p.type =
    p.type === 'password' ? 'text' : 'password';

  $('showPassword').textContent =
    p.type === 'password' ? 'Lihat' : 'Sembunyikan';
};

async function startTurnstile() {
  try {
    $('submitBtn').disabled = true;

    const r = await fetch('/api/auth/config', {
      cache: 'no-store'
    });

    const d = await r.json();

    if (!r.ok || !d.siteKey || !d.authReady) {
      throw new Error('Autentikasi belum siap');
    }

    siteKey = d.siteKey;

    for (let i = 0; i < 80 && !window.turnstile; i++) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    if (!window.turnstile) {
      throw new Error('Turnstile gagal dimuat');
    }

    widgetId = window.turnstile.render('#turnstile', {
      sitekey: siteKey,
      theme: 'light',

      callback: token => {
        if (!token) return;

        turnstileReady = true;
        $('submitBtn').disabled = submitting;

        if (!registrationComplete) {
          if (!$('notice').classList.contains('error')) {
            $('notice').hidden = true;
          }
        }
      },

      'error-callback': code => {
        turnstileReady = false;
        $('submitBtn').disabled = true;

        console.error('Turnstile error:', code);

        if (!registrationComplete) {
          notice(
            'Pemeriksaan keamanan gagal. Kode: ' + code,
            true
          );
        }

        return true;
      },

      'expired-callback': () => {
        turnstileReady = false;
        $('submitBtn').disabled = true;
      },

      'timeout-callback': () => {
        turnstileReady = false;
        $('submitBtn').disabled = true;
      }
    });

  } catch (err) {
    turnstileReady = false;
    $('submitBtn').disabled = true;

    console.error(err);

    notice(
      'Komponen keamanan belum siap. Muat ulang halaman.',
      true
    );
  }
}

$('authForm').onsubmit = async e => {
  e.preventDefault();

  if (submitting || registrationComplete) return;

  const token = widgetId !== null
    ? window.turnstile?.getResponse(widgetId)
    : '';

  if (!turnstileReady || !token) {
    notice('Selesaikan pemeriksaan keamanan.', true);
    return;
  }

  const body = {
    turnstileToken: token
  };

  if (mode !== 'reset') {
    body.email = $('email').value.trim();
  }

  if (!['forgot', 'resend'].includes(mode)) {
    body.password = $('password').value;
  }

  if (mode === 'register') {
    body.username = $('username').value.trim();
    body.displayName = $('displayName').value.trim();
  }

  if (mode === 'login') {
    body.deviceName = navigator.userAgent.slice(0, 80);
  }

  if (mode === 'reset') {
    body.token = params.get('reset');
  }

  const endpoints = {
    login: 'login',
    register: 'register',
    forgot: 'forgot',
    resend: 'resend-verification',
    reset: 'reset'
  };

  submitting = true;
  $('submitBtn').disabled = true;

  try {
    const r = await fetch(
      '/api/auth/' + endpoints[mode],
      {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      }
    );

    const d = await r.json();

    if (!r.ok || !d.ok) {
      throw new Error(
        d.error || 'Gagal memproses permintaan'
      );
    }

    if (mode === 'login') {
      location.replace('/');
      return;
    }

    if (mode === 'register') {
      $('password').value = '';
      showRegistrationSuccess(body.email);
      return;
    }

    notice(d.message || 'Berhasil.');

    if (mode === 'reset') {
      $('password').value = '';
      switchMode('login');
      notice('Password berhasil diubah. Silakan masuk.');
    }

  } catch (err) {
    notice(
      err.message || 'Terjadi gangguan',
      true
    );

  } finally {
    submitting = false;
    turnstileReady = false;

    $('submitBtn').disabled = true;

    if (widgetId !== null && window.turnstile) {
      window.turnstile.reset(widgetId);
    }
  }
};

if (params.has('reset')) {
  switchMode('reset');

} else if (params.has('verified')) {
  notice('Email berhasil diverifikasi. Silakan masuk.');

} else if (params.has('error')) {
  notice(
    'Koneksi tidak tersedia. Periksa internet.',
    true
  );
}

startTurnstile();
