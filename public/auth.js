
'use strict';

const $ = id => document.getElementById(id);

let mode = 'login';
let widgetId = null;
let siteKey = null;
let submitting = false;
let turnstileReady = false;

const params = new URLSearchParams(location.search);

function notice(message, error = false) {
  const n = $('notice');
  n.hidden = false;
  n.textContent = message;
  n.classList.toggle('error', error);
}

function switchMode(next) {
  mode = next;

  $('registerFields').hidden = mode !== 'register';
  $('passwordGroup').hidden = ['forgot', 'resend'].includes(mode);
  $('emailGroup').hidden = mode === 'reset';
  $('tabs').hidden = !['login', 'register'].includes(mode);

  for (const b of $('tabs').querySelectorAll('button')) {
    b.classList.toggle('on', b.dataset.mode === mode);
  }

  $('email').required = mode !== 'reset';
  $('password').required = !['forgot', 'resend'].includes(mode);
  $('displayName').required = mode === 'register';
  $('username').required = mode === 'register';

  $('passwordLabel').textContent =
    mode === 'reset' ? 'Password baru' : 'Password';

  $('password').autocomplete =
    mode === 'login' ? 'current-password' : 'new-password';

  $('submitBtn').textContent = ({
    login: 'Masuk',
    register: 'Daftar akun',
    forgot: 'Kirim link reset',
    resend: 'Kirim ulang verifikasi',
    reset: 'Ganti password'
  })[mode];

  $('forgotBtn').hidden = ['forgot', 'resend', 'reset'].includes(mode);
  $('resendBtn').hidden = ['forgot', 'resend', 'reset'].includes(mode);

  $('notice').hidden = true;

  turnstileReady = false;
  $('submitBtn').disabled = true;

  if (widgetId !== null && window.turnstile) {
    window.turnstile.reset(widgetId);
  }
}

$('tabs').addEventListener('click', e => {
  const next = e.target.dataset.mode;
  if (next) switchMode(next);
});

$('forgotBtn').onclick = () => switchMode('forgot');
$('resendBtn').onclick = () => switchMode('resend');

$('showPassword').onclick = () => {
  const p = $('password');

  p.type = p.type === 'password' ? 'text' : 'password';

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
      throw new Error('Sistem autentikasi belum siap');
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

      callback: function(token) {
        if (!token) return;

        turnstileReady = true;
        $('submitBtn').disabled = submitting;
        $('notice').hidden = true;
      },

      'error-callback': function(code) {
        turnstileReady = false;
        $('submitBtn').disabled = true;

        console.error('TemanChat Turnstile error:', code);

        notice(
          'Pemeriksaan keamanan gagal. Kode: ' + code,
          true
        );

        return true;
      },

      'expired-callback': function() {
        turnstileReady = false;
        $('submitBtn').disabled = true;

        notice(
          'Verifikasi keamanan kedaluwarsa. Silakan ulangi.',
          true
        );
      },

      'timeout-callback': function() {
        turnstileReady = false;
        $('submitBtn').disabled = true;

        notice(
          'Pemeriksaan keamanan terlalu lama. Muat ulang halaman.',
          true
        );
      }
    });

  } catch (err) {
    turnstileReady = false;
    $('submitBtn').disabled = true;

    console.error('TemanChat auth:', err);

    notice(
      'Komponen keamanan belum siap. Muat ulang halaman.',
      true
    );
  }
}

$('authForm').onsubmit = async e => {
  e.preventDefault();

  if (submitting) return;

  const token = widgetId !== null
    ? window.turnstile?.getResponse(widgetId)
    : '';

  if (!turnstileReady || !token) {
    notice(
      'Selesaikan pemeriksaan keamanan dahulu.',
      true
    );
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
    const r = await fetch('/api/auth/' + endpoints[mode], {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

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

    notice(d.message || 'Berhasil.');

    if (mode === 'register' || mode === 'reset') {
      setTimeout(() => switchMode('login'), 1500);
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
    'Koneksi tidak tersedia. Periksa internet dan coba lagi.',
    true
  );
}

startTurnstile();
