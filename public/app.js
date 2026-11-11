'use strict';
// TemanChat V5: chat teks 1:1, D1 backend. Belum ada media, panggilan, atau E2EE.
const $ = id => document.getElementById(id);
let me = null, chats = [], active = null, lastId = 0, searchResults = null;
let timer = null, busyMessages = false, busyChats = false, notificationTimer;
let lastListUpdate = 0, searchSeq = 0, installPrompt = null;

function toast(message) {
  $('toast').textContent = message;
  $('toast').classList.add('visible');
  clearTimeout(notificationTimer);
  notificationTimer = setTimeout(() => $('toast').classList.remove('visible'), 4000);
}
async function api(url, options = {}) {
  let response;
  try {
    response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...options });
  } catch { throw Error('Tidak dapat terhubung. Periksa koneksi internet.'); }
  if (response.status === 401) {
    location.replace('/auth.html');
    throw Error('Sesi telah berakhir');
  }
  let data;
  try { data = await response.json(); } catch { throw Error('Respons server tidak valid.'); }
  if (!response.ok || !data.ok) throw Error(data.error || 'Terjadi kesalahan.');
  return data;
}
function post(path, data) {
  return api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
}
function smallTime(value) {
  if (!value) return '';
  const str = value.replace(' ', 'T');
  const dt = new Date(str.endsWith('Z') ? str : str + 'Z');
  return Number.isNaN(dt.getTime()) ? '' : dt.toLocaleTimeString('id-ID', { hour:'2-digit', minute:'2-digit' });
}
function avatar(name) { return (name || '?').trim().charAt(0).toUpperCase(); }
function dom(tag, className, text) {
  const n = document.createElement(tag); if (className) n.className = className;
  if (text !== undefined) n.textContent = text; return n;
}
function showChat() {
  $('sidebar').classList.remove('mobile-visible');
  $('conversation').classList.remove('mobile-hidden');
}
function showList() {
  $('sidebar').classList.add('mobile-visible');
  $('conversation').classList.add('mobile-hidden');
}
function placeholder(text) {
  const el = dom('div', 'day', text);
  $('messages').replaceChildren(el);
}
function showHeader(c) {
  $('headName').textContent = c ? c.other_name : 'Pilih teman';
  $('headAvatar').textContent = c ? avatar(c.other_name) : '?';
  $('headAvatar').className = 'avatar teal';
  document.querySelector('.chat-person small').textContent = c ? '@' + c.other_username : 'Cari pengguna untuk mulai chat';
  $('messageInput').disabled = !c;
  document.querySelector('.send').disabled = !c;
}
function renderChatList() {
  const root = $('contacts'); root.replaceChildren();
  const q = $('search').value.trim().toLowerCase();
  const list = q.length >= 2 && searchResults !== null
    ? searchResults.map(p => ({ other_name:p.display_name, other_username:p.username, searchPerson:true }))
    : chats.filter(c => !q || c.other_name.toLowerCase().includes(q) || c.other_username.includes(q));
  if (!list.length) {
    root.append(dom('p', 'tc-empty', q.length >= 2 ? 'Tidak ditemukan. Coba username lain.' : 'Belum ada percakapan. Cari username teman di atas.'));
    return;
  }
  for (const c of list) {
    const b = dom('button', 'contact' + (!c.searchPerson && active?.id === c.id ? ' active' : ''));
    b.type = 'button';
    const a = dom('div', 'avatar teal', avatar(c.other_name));
    const content = dom('div', 'contact-content');
    const top = dom('div', 'contact-top');
    top.append(dom('b', '', c.other_name), dom('small', '', c.searchPerson ? 'Mulai chat' : smallTime(c.last_time)));
    content.append(top, dom('p', '', c.searchPerson ? '@' + c.other_username : (c.last_message || '@' + c.other_username)));
    b.append(a, content);
    b.onclick = async () => {
      if (c.searchPerson) {
        try {
          b.disabled = true;
          const result = await post('/api/chat/start', { username:c.other_username });
          $('search').value = ''; searchResults = null;
          await fetchChats();
          const target = chats.find(x => x.id === result.conversationId);
          if (target) await selectChat(target);
        } catch (err) { toast(err.message); b.disabled = false; }
      } else await selectChat(c);
    };
    root.append(b);
  }
}
async function fetchChats() {
  if (busyChats || !me) return;
  busyChats = true;
  try {
    const data = await api('/api/chat/conversations');
    chats = data.conversations;
    if (active) active = chats.find(c => c.id === active.id) || null;
    if (active) showHeader(active);
    if (!$('search').value.trim() || searchResults === null) renderChatList();
  } catch (err) { toast(err.message); }
  finally { busyChats = false; }
}
function addMessage(m) {
  if ($('messages').querySelector(`[data-message-id="${m.id}"]`)) return;
  const b = dom('div', 'bubble ' + (m.sender_id === me.id ? 'me' : 'them'));
  b.dataset.messageId = String(m.id);
  const text = dom('span', '', m.body);
  const time = dom('time', '', smallTime(m.created_at));
  b.append(text, time);
  const scroller = $('messages');
  const nearBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 130;
  scroller.append(b);
  lastId = Math.max(lastId, Number(m.id) || 0);
  if (nearBottom) scroller.scrollTop = scroller.scrollHeight;
}
async function fetchMessages(reset = false) {
  if (!active || busyMessages) return;
  const chatId = active.id;
  busyMessages = true;
  try {
    const after = reset ? 0 : lastId;
    const data = await api(`/api/chat/messages?conversationId=${encodeURIComponent(chatId)}&after=${after}`);
    if (!active || active.id !== chatId) return;
    if (reset) {
      $('messages').replaceChildren(); lastId = 0;
      if (!data.messages.length) placeholder('Belum ada pesan. Mulai percakapan!');
    }
    if (data.messages.length && $('messages').querySelector('.day')) $('messages').replaceChildren();
    for (const m of data.messages) addMessage(m);
  } catch (err) { toast(err.message); }
  finally { busyMessages = false; }
}
async function selectChat(chat) {
  active = chat; lastId = 0;
  showHeader(chat); renderChatList();
  placeholder('Memuat pesan...'); showChat();
  await fetchMessages(true);
}
$('search').addEventListener('input', async () => {
  const q = $('search').value.trim().toLowerCase();
  const seq = ++searchSeq;
  searchResults = null;
  if (q.length < 2) { renderChatList(); return; }
  try {
    const data = await api('/api/chat/people?q=' + encodeURIComponent(q));
    if (seq !== searchSeq) return;
    searchResults = data.people;
    renderChatList();
  } catch (err) { if (seq === searchSeq) toast(err.message); }
});
$('messageForm').addEventListener('submit', async e => {
  e.preventDefault();
  const input = $('messageInput');
  const text = input.value.trim();
  if (!active || !text || text.length > 1000) return;
  const chatId = active.id;
  input.disabled = true;
  try {
    const d = await post('/api/chat/send', { conversationId:chatId, body:text });
    if (active?.id === chatId) {
      input.value = '';
      if ($('messages').querySelector('.day')) $('messages').replaceChildren();
      addMessage(d.message);
    }
    await fetchChats();
  } catch (err) { toast(err.message); }
  finally { input.disabled = !active; if (active) input.focus(); }
});
function modal(title, message, buttons = []) {
  $('modalTitle').textContent = title;
  $('modalDesc').textContent = message;
  const content = $('modalContent'); content.replaceChildren();
  for (const { text, click } of buttons) {
    const b = dom('button', 'primary', text);
    b.onclick = click; content.append(b);
  }
  $('modal').showModal();
}
$('closeModal').onclick = () => $('modal').close();
$('voiceBtn').onclick = () => modal('Telepon suara', 'Fitur panggilan akan ditambahkan setelah chat teks stabil.');
$('videoBtn').onclick = () => modal('Video call', 'Video call belum tersedia pada TemanChat V5.');
$('attachBtn').onclick = () => toast('Pengiriman foto dan file akan hadir di tahap berikutnya.');
$('moreBtn').onclick = () => modal('Informasi percakapan', active ? 'Percakapan pribadi dengan @' + active.other_username + '. Pesan tersimpan di D1, belum terenkripsi ujung-ke-ujung.' : 'Pilih teman terlebih dahulu.');
$('settingsBtn').onclick = () => modal('Akun TemanChat', me ? `${me.display_name} (@${me.username})` : '', [{text:'Keluar dari akun',click: async () => {
  try { await post('/api/auth/logout', {}); location.replace('/auth.html'); }
  catch(err){toast(err.message)}
}}]);
document.querySelector('.chathead').addEventListener('click', e => {
  if (innerWidth <= 740 && (e.target.closest('.chat-person') || e.target === e.currentTarget)) showList();
});
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; });
$('installBtn').onclick = async () => {
  if (window.matchMedia('(display-mode: standalone)').matches) return toast('TemanChat sudah terpasang.');
  if (installPrompt) { installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; return; }
  modal('Pasang TemanChat', /iPad|iPhone|iPod/.test(navigator.userAgent)
    ? 'Di Safari: Bagikan → Tambahkan ke Layar Utama.'
    : 'Di menu browser pilih Instal aplikasi atau Tambahkan ke layar utama.');
};
async function init() {
  showHeader(null); placeholder('Masuk untuk memulai...');
  if (innerWidth <= 740) showList();
  try {
    const data = await api('/api/auth/me');
    me = data.user;
    document.querySelector('.profile b').textContent = me.display_name;
    document.querySelector('.profile small').textContent = '@' + me.username;
    document.querySelector('.profile .avatar').textContent = avatar(me.display_name);
    document.documentElement.classList.add('tc-auth-ready');
    $('mode').innerHTML = '<span class="dot"></span> Pesan teks aktif · V5';
    placeholder('Cari username teman untuk memulai percakapan.');
    await fetchChats();
    timer = setInterval(async () => {
      if (document.hidden) return;
      if (active) await fetchMessages();
      if (Date.now() - lastListUpdate > 8000) { lastListUpdate = Date.now(); await fetchChats(); }
    }, 4000);
  } catch (err) { if (err.message !== 'Sesi telah berakhir') location.replace('/auth.html?error=network'); }
}
init();
