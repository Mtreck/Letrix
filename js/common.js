// Funções compartilhadas entre a tela do aluno e a do mediador

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const TEAMS = {
  A: { name: 'Time Azul', emoji: '🔵', cls: 'team-a' },
  B: { name: 'Time Vermelho', emoji: '🔴', cls: 'team-b' },
};

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

// Classes secretas (estilo Cidade Dorme)
const ROLES = {
  cidadao: {
    name: 'Cidadão', emoji: '🙂',
    desc: 'Converse com seu time, descubra a palavra rival e desconfie de todo mundo!',
  },
  espiao: {
    name: 'Espião', emoji: '🕵️',
    desc: 'A cada discussão você recebe uma letra secreta da palavra rival. Conte para o time... se confiar nele!',
  },
  vidente: {
    name: 'Vidente', emoji: '🔮',
    desc: 'Em cada discussão você pode perguntar se uma letra está na palavra rival. Só você vê a resposta.',
  },
  guardiao: {
    name: 'Guardião', emoji: '🛡️',
    desc: 'Você tem um escudo: seu primeiro erro no duelo (por rodada) não tira vida.',
  },
  impostor: {
    name: 'Impostor', emoji: '🎭',
    desc: 'Você joga escondido pelo time rival! Engane seu time na discussão e não deixe descobrirem a palavra. Cuidado com a votação!',
  },
};

// Classe e tamanho mínimo do time para ela aparecer
const ROLE_SETUP = [['espiao', 2], ['vidente', 3], ['impostor', 4], ['guardiao', 5]];

const rival = (team) => (team === 'A' ? 'B' : 'A');
const $ = (sel) => document.querySelector(sel);

function configOk() {
  return !SUPABASE_URL.includes('SEU-PROJETO') && !SUPABASE_ANON_KEY.includes('SUA-CHAVE');
}

// "Guarda-Chuva " -> "guarda chuva" (sem acento, minúsculo)
function normalize(text) {
  return String(text || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
}

function esc(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// Letras diferentes da palavra, sem acento: "Pipoca" -> ['p','i','o','c','a']
function wordLetters(word) {
  return [...new Set([...normalize(word)].filter((c) => /[a-z]/.test(c)))];
}

function letterCount(word) {
  return [...normalize(word)].filter((c) => /[a-z]/.test(c)).length;
}

function isComplete(word, tried) {
  return wordLetters(word).every((l) => tried.includes(l));
}

// Desenha a palavra como na forca: só aparecem as letras já descobertas
// Cada pedaço da palavra (separado por espaço ou hífen) fica junto, sem quebrar no meio
function maskHTML(word, tried) {
  const slot = (ch) => {
    const n = normalize(ch);
    if (!/[a-z]/.test(n)) return `<span class="slot dash">${esc(ch)}</span>`;
    const show = (tried || '').includes(n);
    return `<span class="slot${show ? ' open' : ''}">${show ? esc(ch.toUpperCase()) : ''}</span>`;
  };
  return String(word || '').split(' ').filter(Boolean)
    .map((part) => part.match(/[^-]+-?|-/g)
      .map((piece) => `<span class="piece">${[...piece].map(slot).join('')}</span>`).join(''))
    .join('<span class="gap"></span>');
}

// Só troca o HTML se mudou (evita repetir a animação das letras a cada atualização)
function setHTML(el, html) {
  if (el && el._html !== html) { el.innerHTML = html; el._html = html; }
}

function hearts(lives, max) {
  const l = Math.max(0, lives);
  if (l === 0) return '☠️ FORA';
  return '❤️'.repeat(l) + '🖤'.repeat(Math.max(0, max - l));
}

function toast(text) {
  let el = $('#toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 3000);
}

// ---------- Sons e efeitos ----------

let audioCtx = null;
document.addEventListener('pointerdown', () => {
  if (audioCtx) return;
  try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { /* sem som */ }
});

function playSound(kind) {
  if (!audioCtx) return;
  const notes = {
    hit: [660, 880],
    miss: [220, 150],
    win: [523, 659, 784, 1047],
    out: [330, 220, 130],
    spin: [440, 554, 659],
    tick: [1200],
  }[kind];
  if (!notes) return;
  notes.forEach((freq, i) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = kind === 'miss' || kind === 'out' ? 'sawtooth' : 'triangle';
    osc.frequency.value = freq;
    const t = audioCtx.currentTime + i * 0.13;
    gain.gain.setValueAtTime(0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + 0.3);
  });
}

// Atualiza uma barra de cronômetro (seconds = tempo restante, total = tempo da fase)
function drawTimer(box, seconds, total) {
  if (!box) return;
  box.hidden = seconds === null || !total;
  if (box.hidden) return;
  const s = Math.max(0, seconds);
  box.querySelector('.timer-bar').style.width = (100 * s / total) + '%';
  box.querySelector('.timer-num').textContent = s > 0 ? Math.ceil(s) + 's' : '⏰ 0s';
  box.classList.toggle('urgent', s <= 5);
}

// Chances que ainda restam no duelo atual
function chancesText(r) {
  const left = (t) => Math.max(0, r.turns_max - r['turns_' + t]);
  return `🎯 Chances restantes: 🔵 ${left('a')} de ${r.turns_max} · 🔴 ${left('b')} de ${r.turns_max}`;
}

// "e+x-" -> "E ✅  X ❌"
function visionsText(vision) {
  return (vision.match(/../g) || [])
    .map((v) => `${v[0].toUpperCase()} ${v[1] === '+' ? '✅' : '❌'}`).join('   ');
}

// Toca som + animação quando chega uma jogada nova
let lastEventId = null;
function fxOnEvent(room) {
  if (lastEventId !== null && room.event_id !== lastEventId && room.event_kind) {
    playSound(room.event_kind);
    document.body.classList.remove('fx-hit', 'fx-miss', 'fx-win', 'fx-out', 'fx-spin');
    void document.body.offsetWidth; // reinicia a animação
    document.body.classList.add('fx-' + room.event_kind);
  }
  lastEventId = room.event_id;
}

// ---------- Tempo real ----------

// Escuta mudanças em tempo real + atualização a cada 3s como garantia
function watchRoom(roomId, onChange) {
  let timer = null;
  const trigger = () => {
    clearTimeout(timer);
    timer = setTimeout(onChange, 100);
  };
  db.channel('sala-' + roomId)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` }, trigger)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'players', filter: `room_id=eq.${roomId}` }, trigger)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'players', filter: `room_id=eq.${roomId}` }, trigger)
    // O Supabase não filtra DELETE; remoções são raras, então escutamos todas
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'players' }, trigger)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'guesses', filter: `room_id=eq.${roomId}` }, trigger)
    .subscribe();
  setInterval(onChange, 3000);
}

// Evita duas cargas ao mesmo tempo; se pedirem outra no meio, roda de novo no fim
function singleFlight(fn) {
  let running = false;
  let again = false;
  return async function run() {
    if (running) { again = true; return; }
    running = true;
    try { await fn(); } catch (err) { console.error(err); }
    running = false;
    if (again) { again = false; run(); }
  };
}
