// Tela do mediador (professor)
// Esta tela também é o "juiz" e o "motor" do jogo: confere as jogadas, conta os votos
// e faz o ciclo andar sozinho:
//   nova rodada → discussão → resultado dos votos → roleta → duelo → resultado → discussão → ...
// A rodada acaba quando alguém descobre a palavra ou um time inteiro cai.
// O jogo acaba quando um time chega aos pontos para vencer (ou o mediador encerra).
// Por isso esta tela precisa ficar aberta durante o jogo.

const ROOM_KEY = 'duelo_sala';

const WORDS = [
  'abacaxi', 'girafa', 'computador', 'bicicleta', 'chocolate', 'futebol', 'guarda-chuva',
  'dinossauro', 'pipoca', 'foguete', 'tartaruga', 'violão', 'sorvete', 'pirata', 'escova',
  'travesseiro', 'helicóptero', 'melancia', 'camaleão', 'teclado', 'mochila', 'vulcão',
  'pinguim', 'sanduíche', 'robô', 'arco-íris', 'geladeira', 'borboleta', 'labirinto',
  'castelo', 'astronauta', 'jacaré', 'internet', 'pizza', 'relógio', 'trampolim',
  'esqueleto', 'cachoeira', 'lanterna', 'tubarão', 'videogame', 'celular', 'bruxa',
];

// Quanto tempo cada resultado fica na tela antes da próxima fase (segundos)
const SHOW_RESULT = 6;   // resultado de duelo ou de votação
const SHOW_ROUND = 9;    // fim de rodada (palavra descoberta / time eliminado)
const SPIN_RECOVER = 15; // se a roleta travar (ex.: página recarregada), gira de novo

const STATUS_LABEL = {
  lobby: '⏳ Sala de espera',
  talk: '💬 Discussão',
  spinning: '🎡 Roleta',
  duel: '⚔️ Duelo',
  result: '🏁 Resultado',
  end: '🏆 Fim de jogo',
};
const NEXT_LABEL = { talk: '💬 Discussão', spin: '🎡 Roleta', round: '🔄 Nova rodada', end: '🏆 Fim de jogo' };

let room = null;
let players = [];
let guesses = [];
let inputsFilled = false;
let showSecrets = false;
let spinning = false;    // a roleta está girando nesta tela
let processing = false;  // conferindo uma jogada
let stepping = false;    // trocando de fase
let lastBeep = null;

const now = () => new Date().toISOString();
const later = (s) => new Date(Date.now() + s * 1000).toISOString();
const shuffle = (list) => [...list].sort(() => Math.random() - 0.5);
const randomItem = (list) => list[Math.floor(Math.random() * list.length)];
const low = (t) => t.toLowerCase();

const wheelA = new Wheel($('#wheel-a'), ['#2e4be0', '#5a72f0', '#1f36b8', '#8597f5']);
const wheelB = new Wheel($('#wheel-b'), ['#f2435a', '#f7707f', '#c92a40', '#fa9aa6']);

const updateRoom = (patch) => db.from('rooms').update(patch).eq('id', room.id);
const fetchRoom = async () => (await db.from('rooms').select('*').eq('id', room.id).single()).data;
const fetchPlayers = async () => (await db.from('players').select('*').eq('room_id', room.id)).data || [];
const alive = (team, list = players) => list.filter((p) => p.team === team && p.lives > 0);
const running = () => room && !['lobby', 'end'].includes(room.status);

// ---------- Criar / abrir sala ----------

function randomCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  return Array.from({ length: 4 }, () => randomItem(letters)).join('');
}

$('#create-room').addEventListener('click', async () => {
  let lastError = null;
  for (let i = 0; i < 5; i++) {
    const { data, error } = await db.from('rooms').insert({ code: randomCode() }).select().single();
    if (!error) return openRoom(data);
    lastError = error;
    if (error.code !== '23505') break; // só tenta de novo se o código da sala já existir
  }
  console.error(lastError);
  const detail = lastError?.message || 'erro desconhecido';
  const hint = /fetch|network/i.test(detail)
    ? 'Não consegui falar com o Supabase: confira a URL no config.js e se o projeto não está pausado.'
    : 'Confira o config.js e se o supabase.sql foi executado.';
  $('#create-error').textContent = `Não foi possível criar a sala. ${hint} (Detalhe: ${detail})`;
});

$('#open-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = $('#open-code').value.trim().toUpperCase();
  const { data } = await db.from('rooms').select('*').eq('code', code).maybeSingle();
  if (!data) return ($('#create-error').textContent = 'Sala não encontrada.');
  openRoom(data);
});

function openRoom(r) {
  room = r;
  if (!('turns_max' in r)) {
    $('#create-error').textContent =
      'O banco está desatualizado: rode o arquivo supabase-atualizacao.sql no SQL Editor do Supabase.';
    $('#create').hidden = false;
    return;
  }
  localStorage.setItem(ROOM_KEY, r.code);
  $('#create').hidden = true;
  $('#panel').hidden = false;
  const url = new URL('index.html', location.href);
  url.search = '?sala=' + r.code;
  $('#join-url').textContent = url.href;
  watchRoom(room.id, load);
  setInterval(tick, 250);
  load();
}

$('#close-room').addEventListener('click', async () => {
  if (!confirm('Apagar esta sala? Todos os alunos serão desconectados.')) return;
  await db.from('rooms').delete().eq('id', room.id);
  localStorage.removeItem(ROOM_KEY);
  location.reload();
});

// ---------- Relógio do jogo ----------
// Os horários são gravados por esta tela, então o relógio dela é a referência.
// Pausado, o tempo "para" no instante da pausa.

const clockNow = () => (room.paused && room.paused_at ? Date.parse(room.paused_at) : Date.now());
const secondsLeft = (start, total) => total - (clockNow() - Date.parse(start)) / 1000;

function beepLastSeconds(left) {
  if (room.paused) return;
  if (left > 0 && left <= 5 && Math.ceil(left) !== lastBeep) {
    lastBeep = Math.ceil(left);
    playSound('tick');
  }
}

function tick() {
  if (!room) return;
  const s = room.status;

  // cronômetros
  let talkLeft = null;
  let turnLeft = null;
  if (s === 'talk' && room.talk_started_at) talkLeft = secondsLeft(room.talk_started_at, room.talk_seconds);
  if (s === 'duel' && room.turn_seconds && room.turn_started_at) turnLeft = secondsLeft(room.turn_started_at, room.turn_seconds);
  drawTimer($('#talk-timer'), talkLeft, room.talk_seconds);
  drawTimer($('#timer'), turnLeft, room.turn_seconds);
  if (talkLeft !== null) beepLastSeconds(talkLeft);
  if (turnLeft !== null) beepLastSeconds(turnLeft);

  // aviso da próxima fase
  let info = '';
  if (room.paused) info = '⏸ Jogo pausado';
  else if (s === 'result' && room.phase_until && NEXT_LABEL[room.next_step]) {
    const left = Math.max(0, Math.ceil((Date.parse(room.phase_until) - Date.now()) / 1000));
    info = `A seguir: ${NEXT_LABEL[room.next_step]} em ${left}s`;
  }
  $('#phase-info').textContent = info;

  if (room.paused || stepping || processing || spinning) return;

  // o motor: decide se é hora de trocar de fase
  if (s === 'talk' && talkLeft !== null && talkLeft <= 0) return step(endTalk);
  if (s === 'duel' && turnLeft !== null && turnLeft <= -0.5) return step(timeout); // tolerância da internet
  if (s === 'result' && room.phase_until && Date.now() >= Date.parse(room.phase_until)) return step(runNext);
  if (s === 'spinning' && room.phase_until && Date.now() >= Date.parse(room.phase_until)) return step(doSpin);
}

// Executa uma troca de fase de cada vez
async function step(fn) {
  if (stepping) return;
  stepping = true;
  try {
    await fn();
  } catch (err) {
    console.error(err);
  }
  stepping = false;
  load();
}

// ---------- Carregar ----------

const load = singleFlight(async () => {
  const { data: r } = await db.from('rooms').select('*').eq('id', room.id).maybeSingle();
  if (!r) { localStorage.removeItem(ROOM_KEY); return location.reload(); }
  const { data: ps } = await db.from('players').select('*').eq('room_id', r.id).order('created_at');
  const { data: gs } = await db.from('guesses').select('*')
    .eq('room_id', r.id).eq('duel', r.duel).order('id');
  room = r;
  players = ps || [];
  guesses = gs || [];
  render();
  if (await checkMissingDuelist()) return;
  processGuesses();
});

// Se um duelista saiu ou foi removido no meio do duelo, encerra o duelo e o ciclo segue
let endingDuel = false;
async function checkMissingDuelist() {
  if (room.status !== 'duel' || endingDuel || processing) return false;
  const missing = ['A', 'B'].filter((t) => !players.some((p) => p.id === room['duel_' + low(t)]));
  if (!missing.length) return false;
  endingDuel = true;
  try {
    const msg = `🚪 ${missing.map((t) => `O duelista do ${TEAMS[t].name}`).join(' e ')} saiu da sala. Duelo encerrado.`;
    await db.from('guesses').update({ result: 'ignored' })
      .eq('room_id', room.id).eq('duel', room.duel).is('result', null);
    const ps = await fetchPlayers();
    const patch = { event_kind: 'out', event_id: room.event_id + 1 };
    const next = teamWipe(room, ps, patch) || 'talk';
    finish(patch, msg + (patch.extra || ''), next);
    await db.from('rooms').update(patch).eq('id', room.id).eq('duel', room.duel).eq('status', 'duel');
  } finally {
    endingDuel = false;
  }
  load();
  return true;
}

// ---------- Fases ----------

// Monta o "resultado" na tela e diz o que vem depois
function finish(patch, message, next) {
  delete patch.extra;
  patch.status = 'result';
  patch.message = message;
  patch.event = message;
  patch.next_step = next;
  patch.phase_until = later(next === 'round' || next === 'end' ? SHOW_ROUND : SHOW_RESULT);
}

// Algum time chegou aos pontos para vencer?
function reachedTarget(r, patch) {
  const a = patch.score_a ?? r.score_a;
  const b = patch.score_b ?? r.score_b;
  return a >= r.target_score || b >= r.target_score;
}

// Se um time inteiro está sem vidas, o outro ganha o ponto e a rodada acaba
function teamWipe(r, ps, patch) {
  for (const team of ['A', 'B']) {
    if (alive(team, ps).length) continue;
    const other = rival(team);
    const key = 'score_' + low(other);
    patch[key] = (patch[key] ?? r[key]) + 1;
    patch.extra = ` Todo o ${TEAMS[team].name} foi eliminado: ponto para o ${TEAMS[other].name}!`;
    return reachedTarget(r, patch) ? 'end' : 'round';
  }
  return null;
}

// O que vem depois de um resultado
async function runNext() {
  const r = await fetchRoom();
  if (r.status !== 'result' || r.paused) return;
  room = r;
  if (r.next_step === 'talk') return startTalk();
  if (r.next_step === 'spin') return doSpin();
  if (r.next_step === 'round') return newRound();
  if (r.next_step === 'end') return finishGame();
}

// Sorteia duas palavras ainda não usadas neste jogo
function pickWords(r) {
  const custom = r.word_list.split('\n').map((w) => w.trim()).filter((w) => wordLetters(w).length);
  const pool = custom.length >= 2 ? custom : WORDS;
  const used = r.used_words.split('\n').map(normalize);
  let options = pool.filter((w) => !used.includes(normalize(w)));
  let reset = false;
  if (options.length < 2) { options = pool; reset = true; } // acabaram: recomeça a lista
  const a = randomItem(options);
  const b = randomItem(options.filter((w) => normalize(w) !== normalize(a))) || randomItem(WORDS.filter((w) => w !== a));
  return { a, b, used: (reset ? [] : r.used_words.split('\n').filter(Boolean)).concat(a, b).join('\n') };
}

// Sorteia as classes de cada time e enche as vidas
async function assignRoles(r) {
  const ps = await fetchPlayers();
  const updates = [];
  for (const team of ['A', 'B']) {
    const list = shuffle(ps.filter((p) => p.team === team));
    const roles = ROLE_SETUP.filter(([, min]) => list.length >= min).map(([role]) => role);
    list.forEach((p, i) => {
      const role = roles[i] || 'cidadao';
      updates.push(db.from('players').update({
        role, shield: role === 'guardiao', secret: '', vision: '', vision_talk: -1,
        vote: null, lives: r.lives_max,
      }).eq('id', p.id));
    });
  }
  await Promise.all(updates);
}

async function newRound() {
  const r = await fetchRoom();
  const words = pickWords(r);
  await assignRoles(r);
  await updateRoom({
    word_a: words.a, word_b: words.b, used_words: words.used, tried_a: '', tried_b: '',
    round: r.round + 1, duel_a: null, duel_b: null,
  });
  await startTalk(`🔄 Rodada ${r.round + 1}! Palavras novas, classes novas e vidas cheias.`);
}

async function startTalk(intro) {
  const r = await fetchRoom();
  const ps = await fetchPlayers();

  // Se nenhum time tem 2 pessoas vivas, não há o que discutir: vai direto para a roleta
  if (alive('A', ps).length < 2 && alive('B', ps).length < 2) {
    room = r;
    return doSpin(intro);
  }

  // Zera os votos e dá uma letra nova para cada espião vivo
  await Promise.all(ps.map((p) => {
    const patch = { vote: null };
    if (p.role === 'espiao' && p.lives > 0) {
      const t = low(rival(p.team));
      const options = wordLetters(r['word_' + t])
        .filter((l) => !r['tried_' + t].includes(l) && !p.secret.includes(l));
      if (options.length > 1) patch.secret = p.secret + randomItem(options);
    }
    return db.from('players').update(patch).eq('id', p.id);
  }));

  await db.from('rooms').update({
    status: 'talk',
    talk: r.talk + 1,
    talk_started_at: now(),
    phase_until: null,
    next_step: '',
    duel_a: null,
    duel_b: null,
    message: '',
    event: (intro ? intro + ' ' : '') + '💬 Hora da discussão! Que palavra será? Quem é o impostor?',
    event_kind: 'spin',
    event_id: r.event_id + 1,
  }).eq('id', room.id);
}

// Conta os votos de cada time: a maioria dos vivos precisa concordar
async function endTalk() {
  const r = await fetchRoom();
  if (r.status !== 'talk') return;
  const ps = await fetchPlayers();
  const patch = { event_id: r.event_id + 1, event_kind: '', event: '' };
  const msgs = [];

  for (const team of ['A', 'B']) {
    const t = TEAMS[team];
    const living = alive(team, ps);
    if (living.length < 2) continue; // sozinho não tem votação
    const count = {};
    living.forEach((p) => {
      if (p.vote && living.some((x) => x.id === p.vote)) count[p.vote] = (count[p.vote] || 0) + 1;
    });
    const ranking = Object.entries(count).sort((a, b) => b[1] - a[1]);
    if (!ranking.length) { msgs.push(`${t.emoji} ${t.name} não acusou ninguém.`); continue; }

    const [topId, topVotes] = ranking[0];
    const tie = ranking.length > 1 && ranking[1][1] === topVotes;
    if (tie || topVotes < Math.floor(living.length / 2) + 1) {
      msgs.push(`${t.emoji} ${t.name} não chegou a um acordo.`);
      continue;
    }

    const accused = living.find((p) => p.id === topId);
    const role = ROLES[accused.role] || ROLES.cidadao;
    await db.from('players').update({ lives: 0 }).eq('id', accused.id);
    accused.lives = 0;
    if (accused.role === 'impostor') {
      patch['score_' + low(team)] = r['score_' + low(team)] + 1;
      patch.event_kind = 'win';
      msgs.push(`🎭 ${t.name} desmascarou ${accused.name}: era o IMPOSTOR! +1 ponto!`);
    } else {
      if (patch.event_kind !== 'win') patch.event_kind = 'out';
      msgs.push(`😱 ${t.name} acusou ${accused.name}, mas era ${role.emoji} ${role.name}! Está fora da rodada.`);
    }
  }

  let next = teamWipe(r, ps, patch);
  if (!next) next = reachedTarget(r, patch) ? 'end' : 'spin';
  finish(patch, (msgs.join(' ') || '💬 Fim da discussão.') + (patch.extra || ''), next);
  await db.from('rooms').update(patch).eq('id', room.id).eq('status', 'talk');
}

// Sorteia priorizando quem foi sorteado menos vezes
function pick(list) {
  const min = Math.min(...list.map((p) => p.picked));
  return randomItem(list.filter((p) => p.picked === min));
}

async function doSpin(intro) {
  const r = await fetchRoom();
  const ps = await fetchPlayers();
  const teamA = alive('A', ps);
  const teamB = alive('B', ps);
  if (!teamA.length || !teamB.length) {
    // não dá para duelar: decide a rodada
    const patch = { event_id: r.event_id + 1, event_kind: 'out' };
    const next = teamWipe(r, ps, patch) || 'round';
    finish(patch, '⚠️ Um dos times está sem jogadores.' + (patch.extra || ''), next);
    return updateRoom(patch);
  }

  spinning = true;
  try {
    const pa = pick(teamA);
    const pb = pick(teamB);
    const first = Math.random() < 0.5 ? 'A' : 'B';
    await updateRoom({
      status: 'spinning', duel_a: null, duel_b: null, message: '',
      event: (intro ? intro + ' ' : '') + '🎡 A roleta está girando...', event_kind: 'spin',
      event_id: r.event_id + 1, phase_until: later(SPIN_RECOVER), next_step: '',
    });
    await Promise.all([
      wheelA.spinTo(teamA.map((p) => p.name), teamA.indexOf(pa)),
      wheelB.spinTo(teamB.map((p) => p.name), teamB.indexOf(pb), 5000),
    ]);
    await Promise.all([
      db.from('players').update({ picked: pa.picked + 1 }).eq('id', pa.id),
      db.from('players').update({ picked: pb.picked + 1 }).eq('id', pb.id),
    ]);
    const fresh = await fetchRoom();
    await updateRoom({
      status: 'duel',
      duel: fresh.duel + 1,
      duel_a: pa.id,
      duel_b: pb.id,
      turn: first,
      turns_a: 0,
      turns_b: 0,
      turn_started_at: now(),
      // se pausaram durante a roleta, o duelo já começa congelado
      paused_at: fresh.paused ? now() : fresh.paused_at,
      phase_until: null,
      event: `🎡 ${pa.name} 🔵 VS 🔴 ${pb.name}! Começa: ${(first === 'A' ? pa : pb).name}`,
      event_kind: 'spin',
      event_id: fresh.event_id + 1,
    });
  } finally {
    spinning = false;
  }
}

async function finishGame() {
  const r = await fetchRoom();
  const { score_a: a, score_b: b } = r;
  const msg = a === b
    ? `🤝 Fim de jogo: empate em ${a} a ${b}!`
    : `🏆 ${TEAMS[a > b ? 'A' : 'B'].name} venceu o jogo por ${Math.max(a, b)} a ${Math.min(a, b)}!`;
  await updateRoom({
    status: 'end', paused: false, next_step: '', phase_until: null, duel_a: null, duel_b: null,
    message: msg, event: msg, event_kind: 'win', event_id: r.event_id + 1,
  });
}

// ---------- Juiz do duelo ----------

// Passa a vez e gasta uma chance; se os dois gastaram todas, o duelo acaba
function passTurn(r, patch, team) {
  const key = 'turns_' + low(team);
  patch[key] = r[key] + 1;
  patch.turn = rival(team);
  const usedA = patch.turns_a ?? r.turns_a;
  const usedB = patch.turns_b ?? r.turns_b;
  if (usedA >= r.turns_max && usedB >= r.turns_max) {
    finish(patch, `${patch.event} 🎯 Acabaram as chances do duelo e ninguém descobriu a palavra.`, 'talk');
  }
}

async function timeout() {
  const r = await fetchRoom();
  if (r.status !== 'duel' || r.paused) return;
  if (guesses.some((g) => !g.result)) return; // a jogada chegou a tempo e ainda está sendo conferida
  const p = players.find((x) => x.id === (r.turn === 'A' ? r.duel_a : r.duel_b));
  const patch = {
    turn_started_at: now(),
    event: `⏰ Tempo esgotado! ${p ? p.name : 'O jogador'} perdeu a vez.`,
    event_kind: 'miss',
    event_id: r.event_id + 1,
  };
  passTurn(r, patch, r.turn);
  await db.from('rooms').update(patch).eq('id', r.id).eq('event_id', r.event_id); // evita passar a vez duas vezes
}

async function processGuesses() {
  if (processing || stepping) return;
  const g = guesses.find((x) => !x.result);
  if (!g) return;
  processing = true;
  try {
    await applyGuess(g);
  } catch (err) {
    console.error(err);
  }
  processing = false;
  load();
}

async function applyGuess(g) {
  const setResult = (result) => db.from('guesses').update({ result }).eq('id', g.id);
  const r = room;
  const turnId = r.turn === 'A' ? r.duel_a : r.duel_b;
  const p = players.find((x) => x.id === g.player_id);
  if (r.status !== 'duel' || r.paused || g.player_id !== turnId || !p) return setResult('ignored');

  const team = g.team;
  const other = rival(team);
  const ok = low(other);                 // palavra que está sendo atacada
  const word = r['word_' + ok];
  let tried = r['tried_' + ok];
  const patch = { event_id: r.event_id + 1, turn_started_at: now() }; // toda jogada reinicia o tempo
  let result;
  let livesLost = 0;

  if (g.kind === 'letter') {
    const L = normalize(g.guess).charAt(0);
    if (!/[a-z]/.test(L) || tried.includes(L)) return setResult('ignored');
    tried += L;
    patch['tried_' + ok] = tried;
    if (wordLetters(word).includes(L)) {
      const n = [...word].filter((c) => normalize(c) === L).length;
      result = isComplete(word, tried) ? 'win' : 'hit';
      patch.event_kind = 'hit';
      patch.event = `✅ ${p.name} chutou "${L.toUpperCase()}": tem ${n}! Joga de novo!`;
    } else {
      result = 'miss';
      livesLost = 1;
      patch.event_kind = 'miss';
      patch.event = `❌ ${p.name} chutou "${L.toUpperCase()}": não tem!`;
    }
  } else if (normalize(g.guess) === normalize(word)) {
    result = 'win';
  } else {
    result = 'wrong';
    livesLost = 2;
    patch.event_kind = 'miss';
    patch.event = `💥 ${p.name} chutou a palavra "${g.guess}" e ERROU!`;
  }

  // Descobriu a palavra: ponto e fim da rodada
  if (result === 'win') {
    patch.event_kind = 'win';
    patch['tried_' + ok] = [...new Set(tried + wordLetters(word).join(''))].join('');
    patch['score_' + low(team)] = r['score_' + low(team)] + 1;
    patch.event = '';
    let msg = `🏆 ${p.name} (${TEAMS[team].name}) descobriu a palavra ${word.toUpperCase()}! +1 ponto!`;
    const impostors = players.filter((x) => x.role === 'impostor');
    if (impostors.length) {
      msg += ' 🎭 Os impostores eram: ' + impostors.map((x) => `${x.name} ${TEAMS[x.team].emoji}`).join(' e ') + '!';
    }
    finish(patch, msg, reachedTarget(r, patch) ? 'end' : 'round');
    await setResult(result);
    return db.from('rooms').update(patch).eq('id', r.id).eq('duel', r.duel);
  }

  // Escudo do guardião segura o primeiro erro da rodada
  if (livesLost && p.role === 'guardiao' && p.shield) {
    await db.from('players').update({ shield: false }).eq('id', p.id);
    patch.event += ' 🛡️ Mas o escudo do Guardião protegeu!';
    livesLost = 0;
    passTurn(r, patch, team);
  } else if (livesLost) {
    const lives = Math.max(0, p.lives - livesLost);
    patch.event += ` Perdeu ${livesLost} vida${livesLost > 1 ? 's' : ''}.`;
    await db.from('players').update({ lives }).eq('id', p.id);
    if (lives > 0) {
      passTurn(r, patch, team);          // errou: passa a vez e gasta uma chance
    } else {
      patch.event_kind = 'out';
      const ps = players.map((x) => (x.id === p.id ? { ...x, lives: 0 } : x));
      const next = teamWipe(r, ps, patch) || 'talk';
      finish(patch, `${patch.event} ☠️ ${p.name} está FORA!${patch.extra || ''}`, next);
    }
  }

  await setResult(result);
  await db.from('rooms').update(patch).eq('id', r.id).eq('duel', r.duel);
}

// ---------- Desenhar ----------

function render() {
  fxOnEvent(room);
  const s = room.status;
  $('#room-code').textContent = room.code;
  $('#room-status').textContent = room.paused ? '⏸ Pausado' : (STATUS_LABEL[s] || s);
  $('#score-a').textContent = room.score_a;
  $('#score-b').textContent = room.score_b;
  $('#goal').textContent = running() || s === 'end'
    ? `Rodada ${room.round} · vence quem fizer ${room.target_score} ponto${room.target_score > 1 ? 's' : ''}`
    : `Vence quem fizer ${room.target_score} ponto${room.target_score > 1 ? 's' : ''}`;

  $('#cur-a').textContent = room.word_a ? room.word_a.toUpperCase() : '—';
  $('#cur-b').textContent = room.word_b ? room.word_b.toUpperCase() : '—';
  document.querySelectorAll('.secret').forEach((el) => el.classList.toggle('visible', showSecrets));
  setHTML($('#mask-a'), maskHTML(room.word_a, room.tried_a));
  setHTML($('#mask-b'), maskHTML(room.word_b, room.tried_b));
  $('#tried-a').textContent = room.tried_a ? 'Chutadas: ' + room.tried_a.toUpperCase().split('').join(' ') : '';
  $('#tried-b').textContent = room.tried_b ? 'Chutadas: ' + room.tried_b.toUpperCase().split('').join(' ') : '';

  if (!inputsFilled) {
    $('#word-list').value = room.word_list;
    $('#lives-max').value = room.lives_max;
    $('#turn-seconds').value = room.turn_seconds;
    $('#talk-seconds').value = room.talk_seconds;
    $('#turns-max').value = room.turns_max;
    $('#target-score').value = room.target_score;
    inputsFilled = true;
  }

  // Controles: antes/depois do jogo só "Começar"; durante, só pausar e encerrar
  $('#start-game').hidden = running();
  $('#start-game').textContent = s === 'end' ? '▶ Começar novo jogo' : '▶ Começar jogo';
  $('#run-controls').hidden = !running();
  $('#pause').textContent = room.paused ? '▶ Continuar' : '⏸ Pausar';
  $('#pause').classList.toggle('primary', !!room.paused);
  $('#pause').disabled = s === 'spinning';
  document.body.classList.toggle('paused', !!room.paused);

  renderTalk();

  const teamA = players.filter((p) => p.team === 'A');
  const teamB = players.filter((p) => p.team === 'B');
  $('#count-a').textContent = teamA.length;
  $('#count-b').textContent = teamB.length;
  $('#list-a').innerHTML = teamA.map(playerItem).join('') || '<li class="muted">Ninguém ainda</li>';
  $('#list-b').innerHTML = teamB.map(playerItem).join('') || '<li class="muted">Ninguém ainda</li>';

  // Roletas: só entram jogadores com vida
  const inDuel = s === 'duel' || (s === 'result' && room.duel_a);
  const wheelListA = alive('A');
  const wheelListB = alive('B');
  wheelA.setNames(wheelListA.map((p) => p.name), inDuel ? wheelListA.findIndex((p) => p.id === room.duel_a) : -1);
  wheelB.setNames(wheelListB.map((p) => p.name), inDuel ? wheelListB.findIndex((p) => p.id === room.duel_b) : -1);

  // Duelo
  const dA = players.find((p) => p.id === room.duel_a);
  const dB = players.find((p) => p.id === room.duel_b);
  const active = s === 'duel';
  $('#dn-a').textContent = inDuel && dA ? dA.name : '—';
  $('#dn-b').textContent = inDuel && dB ? dB.name : '—';
  $('#dh-a').textContent = inDuel && dA ? hearts(dA.lives, room.lives_max) : '';
  $('#dh-b').textContent = inDuel && dB ? hearts(dB.lives, room.lives_max) : '';
  $('#duelist-a').classList.toggle('active', active && room.turn === 'A');
  $('#duelist-b').classList.toggle('active', active && room.turn === 'B');
  const turnPlayer = room.turn === 'A' ? dA : dB;
  $('#turn').textContent = active && turnPlayer ? `👉 Vez de ${turnPlayer.name} ${TEAMS[room.turn].emoji}` : '';
  $('#chances').textContent = active ? chancesText(room) : '';
  $('#event').textContent = ['duel', 'spinning'].includes(s) ? room.event : '';
  $('#message').textContent = ['result', 'end'].includes(s) ? room.message : '';

  $('#guess-feed').innerHTML = guesses.slice().reverse().map((g) => {
    const p = players.find((x) => x.id === g.player_id);
    const icon = { hit: '✅', win: '🏆', miss: '❌', wrong: '💥', ignored: '⛔' }[g.result] || '⏳';
    const what = g.kind === 'letter' ? `letra <b>${esc(g.guess.toUpperCase())}</b>` : `palavra <b>${esc(g.guess)}</b>`;
    return `<li class="${TEAMS[g.team].cls}">${icon} ${esc(p ? p.name : '?')} chutou ${what}</li>`;
  }).join('') || '<li class="muted">Nenhuma jogada ainda.</li>';
}

// Placar de votos ao vivo (sem mostrar quem votou em quem)
function renderTalk() {
  $('#talk-panel').hidden = room.status !== 'talk';
  if (room.status !== 'talk') return;
  for (const team of ['A', 'B']) {
    const living = alive(team);
    const count = {};
    living.forEach((p) => { if (p.vote) count[p.vote] = (count[p.vote] || 0) + 1; });
    const voted = living.filter((p) => p.vote).length;
    const rows = living
      .filter((p) => count[p.id])
      .sort((a, b) => count[b.id] - count[a.id])
      .map((p) => `<li><span>${esc(p.name)}</span><b>${count[p.id]} 🗳️</b></li>`).join('');
    $('#votes-' + low(team)).innerHTML = living.length < 2
      ? '<li class="muted">Menos de 2 vivos: sem votação.</li>'
      : (rows || '<li class="muted">Nenhum voto ainda</li>') +
        `<li class="muted">${voted}/${living.length} votaram · maioria: ${Math.floor(living.length / 2) + 1}</li>`;
  }
}

function playerItem(p) {
  const role = ROLES[p.role] || ROLES.cidadao;
  const extra = p.role === 'guardiao' && p.shield ? ' 🛡️' : '';
  return `<li class="${p.lives <= 0 ? 'out' : ''}">
    <span>${esc(p.name)}
      <small>${p.lives <= 0 ? '☠️' : '❤️' + p.lives}</small>
      <small class="secret ${showSecrets ? 'visible' : ''}">${role.emoji} ${role.name}${extra}</small>
      ${p.picked ? `<small class="muted">🎯${p.picked}</small>` : ''}</span>
    <span>
      <button class="btn small" data-act="revive" data-id="${p.id}" title="Devolver as vidas">❤️+</button>
      <button class="btn small" data-act="switch" data-id="${p.id}" title="Trocar de time">⇄</button>
      <button class="btn small danger" data-act="remove" data-id="${p.id}" title="Remover">✕</button>
    </span>
  </li>`;
}

// ---------- Ações do mediador ----------

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('button');
  if (!btn || !room) return;

  if (btn.dataset.act) {
    const p = players.find((x) => x.id === btn.dataset.id);
    if (!p) return;
    if (btn.dataset.act === 'switch') await db.from('players').update({ team: rival(p.team), vote: null }).eq('id', p.id);
    if (btn.dataset.act === 'remove') await db.from('players').delete().eq('id', p.id);
    if (btn.dataset.act === 'revive') await db.from('players').update({ lives: room.lives_max }).eq('id', p.id);
    load();
  }

  if (btn.dataset.score) {
    const [team, delta] = btn.dataset.score.split(':');
    const value = Math.max(0, room['score_' + team] + Number(delta));
    await updateRoom({ ['score_' + team]: value });
    load();
  }

  // Dica: revela uma letra que ainda falta
  if (btn.dataset.hint) {
    const t = btn.dataset.hint;
    const tried = room['tried_' + t];
    const missing = wordLetters(room['word_' + t]).filter((l) => !tried.includes(l));
    if (missing.length <= 1) return toast('Não dá para dar mais letras dessa palavra.');
    const letter = randomItem(missing);
    const patch = {
      ['tried_' + t]: tried + letter,
      event: `💡 Dica do mediador: a letra "${letter.toUpperCase()}"!`,
      event_kind: 'hit',
      event_id: room.event_id + 1,
    };
    if (room.status === 'duel') patch.turn_started_at = now(); // dica no meio da vez reinicia o tempo
    await updateRoom(patch);
    load();
  }
});

$('#toggle-secret').addEventListener('click', () => {
  showSecrets = !showSecrets;
  $('#toggle-secret').textContent = showSecrets ? '🙈 Esconder segredos' : '👁 Mostrar segredos';
  render();
});

$('#word-list').addEventListener('change', async () => {
  await updateRoom({ word_list: $('#word-list').value.trim() });
  const n = $('#word-list').value.split('\n').filter((w) => wordLetters(w).length).length;
  toast(n >= 2 ? `Lista salva: ${n} palavras.` : 'Lista vazia: o jogo vai sortear da lista dele.');
  load();
});

const numberSetting = (id, column, min, max, fallback) => {
  $(id).addEventListener('change', async () => {
    const n = Math.max(min, Math.min(max, Math.round(Number($(id).value) || fallback)));
    $(id).value = n;
    // mudar o tempo da jogada reinicia o cronômetro da vez atual
    const patch = { [column]: n };
    if (column === 'turn_seconds' && room.status === 'duel') patch.turn_started_at = room.paused ? room.paused_at : now();
    await updateRoom(patch);
    load();
  });
};
numberSetting('#lives-max', 'lives_max', 1, 10, 5);
numberSetting('#turn-seconds', 'turn_seconds', 0, 120, 0);
numberSetting('#talk-seconds', 'talk_seconds', 10, 600, 60);
numberSetting('#turns-max', 'turns_max', 1, 20, 3);
numberSetting('#target-score', 'target_score', 1, 50, 5);

$('#start-game').addEventListener('click', async () => {
  if (!players.some((p) => p.team === 'A')) return toast('O Time Azul ainda não tem ninguém.');
  if (!players.some((p) => p.team === 'B')) return toast('O Time Vermelho ainda não tem ninguém.');
  $('#start-game').disabled = true;
  await updateRoom({
    score_a: 0, score_b: 0, round: 0, used_words: '', paused: false, paused_at: null,
    status: 'result', next_step: 'round', phase_until: now(), message: '', event: '',
  });
  $('#start-game').disabled = false;
  load(); // o motor vê o "resultado" vencido e começa a 1ª rodada
});

// Pausar congela tudo; continuar empurra todos os horários pelo tempo que ficou parado
$('#pause').addEventListener('click', async () => {
  const r = await fetchRoom();
  if (!r.paused) {
    await updateRoom({ paused: true, paused_at: now() });
  } else {
    const gap = Date.now() - Date.parse(r.paused_at);
    const shift = (t) => (t ? new Date(Date.parse(t) + gap).toISOString() : t);
    await updateRoom({
      paused: false,
      paused_at: null,
      talk_started_at: shift(r.talk_started_at),
      turn_started_at: shift(r.turn_started_at),
      phase_until: shift(r.phase_until),
    });
  }
  load();
});

$('#end-game').addEventListener('click', async () => {
  if (!confirm('Encerrar o jogo agora? Vence quem tiver mais pontos.')) return;
  await step(finishGame);
});

$('#shuffle').addEventListener('click', async () => {
  await Promise.all(shuffle(players).map((p, i) =>
    db.from('players').update({ team: i % 2 === 0 ? 'A' : 'B', vote: null }).eq('id', p.id)));
  toast(running() ? 'Times embaralhados! As classes mudam na próxima rodada.' : 'Times embaralhados!');
  load();
});

// ---------- Início ----------

(async function start() {
  if (!configOk()) {
    $('#create-error').textContent = 'Configure o Supabase no arquivo js/config.js.';
    $('#create-room').disabled = true;
    return;
  }
  const code = localStorage.getItem(ROOM_KEY);
  if (code) {
    const { data } = await db.from('rooms').select('*').eq('code', code).maybeSingle();
    if (data) return openRoom(data);
    localStorage.removeItem(ROOM_KEY);
  }
})();
