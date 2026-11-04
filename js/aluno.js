// Tela do aluno

const STORAGE_KEY = 'duelo_jogador';
let me = null;        // linha do jogador na tabela players
let room = null;
let players = [];
let guesses = [];
let sending = false;
let roleVisible = false;

// Cronômetro: conta a partir do momento em que esta tela viu a fase começar
// Pausado, o cronômetro congela no tempo que faltava e continua dali quando o jogo volta.
const clock = { key: '', deadline: null, frozen: null, total: 0, box: null, beep: false, lastBeep: null };
let wantedClock = ['', 0, null, false]; // definido durante o render

// ---------- Entrar ----------

$('#join-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = $('#join-code').value.trim().toUpperCase();
  const name = $('#join-name').value.trim();
  const btn = e.submitter;
  $('#join-error').textContent = '';
  if (!code || !name) return;

  btn.disabled = true;
  try {
    const { data: found } = await db.from('rooms').select('id, lives_max').eq('code', code).maybeSingle();
    if (!found) throw new Error('Sala não encontrada. Confira o código.');

    // Coloca no time com menos jogadores
    const { data: list } = await db.from('players').select('team').eq('room_id', found.id);
    const countA = list.filter((p) => p.team === 'A').length;
    const countB = list.length - countA;
    const team = countA <= countB ? 'A' : 'B';

    const { data: player, error } = await db.from('players')
      .insert({ room_id: found.id, name, team, lives: found.lives_max })
      .select().single();
    if (error) throw error;

    localStorage.setItem(STORAGE_KEY, JSON.stringify({ id: player.id }));
    enterGame(player);
  } catch (err) {
    $('#join-error').textContent = err.message || 'Erro ao entrar.';
  }
  btn.disabled = false;
});

function enterGame(player) {
  me = player;
  $('#join').hidden = true;
  $('#game').hidden = false;
  buildKeyboard($('#keyboard'));
  buildKeyboard($('#vision-keyboard'));
  watchRoom(me.room_id, load);
  setInterval(tickTimer, 200);
  load();
}

function leave(message) {
  localStorage.removeItem(STORAGE_KEY);
  location.href = location.pathname + (message ? '?msg=' + encodeURIComponent(message) : '');
}

$('#leave').addEventListener('click', async () => {
  await db.from('players').delete().eq('id', me.id);
  leave();
});

// ---------- Cronômetro ----------

function syncClock(key, seconds, box, beep, paused) {
  if (key !== clock.key) {
    clock.key = key;
    clock.deadline = key && seconds ? Date.now() + seconds * 1000 : null;
    clock.frozen = null;
    clock.lastBeep = null;
  }
  if (paused && clock.deadline && clock.frozen === null) clock.frozen = clock.deadline - Date.now();
  if (!paused && clock.frozen !== null) {
    clock.deadline = Date.now() + clock.frozen;
    clock.frozen = null;
  }
  clock.total = seconds;
  clock.box = box;
  clock.beep = beep;
}

function tickTimer() {
  document.querySelectorAll('.timer').forEach((t) => { if (t !== clock.box) t.hidden = true; });
  if (!clock.box) return;
  const ms = clock.frozen !== null ? clock.frozen : (clock.deadline ? clock.deadline - Date.now() : null);
  const left = ms === null ? null : ms / 1000;
  drawTimer(clock.box, left, clock.total);
  // bipe nos últimos 5 segundos para quem está na vez
  if (clock.beep && clock.frozen === null && left !== null && left > 0 && left <= 5) {
    const s = Math.ceil(left);
    if (s !== clock.lastBeep) { clock.lastBeep = s; playSound('tick'); }
  }
}

// ---------- Carregar e desenhar ----------

const load = singleFlight(async () => {
  const { data: r } = await db.from('rooms').select('*').eq('id', me.room_id).maybeSingle();
  if (!r) return leave('A sala foi encerrada.');
  const { data: ps } = await db.from('players').select('*').eq('room_id', r.id).order('created_at');
  const mine = ps.find((p) => p.id === me.id);
  if (!mine) return leave('Você saiu ou foi removido da sala.');
  const { data: gs } = await db.from('guesses').select('*')
    .eq('room_id', r.id).eq('duel', r.duel).order('id');

  room = r;
  players = ps;
  guesses = gs || [];
  me = mine; // o professor pode ter trocado o time
  render();
});

const key = (t) => t.toLowerCase();
const rivalWord = () => room['word_' + key(rival(me.team))];
const rivalTried = () => room['tried_' + key(rival(me.team))];

function render() {
  const myTeam = TEAMS[me.team];

  fxOnEvent(room);
  document.body.classList.remove('team-a', 'team-b');
  document.body.classList.add(myTeam.cls);
  $('#me-name').textContent = me.name;
  $('#me-lives').textContent = room.status === 'lobby' ? '' : hearts(me.lives, room.lives_max);
  $('#me-team').textContent = `${myTeam.emoji} ${myTeam.name}`;
  $('#score-a').textContent = room.score_a;
  $('#score-b').textContent = room.score_b;

  const statusText = {
    lobby: '⏳ Aguardando o mediador começar o jogo...',
    talk: '💬 DISCUSSÃO! Falem baixo para o outro time não ouvir.',
    spinning: '🎡 A roleta está girando... será que é você?',
    duel: '⚔️ DUELO!',
    result: room.message || 'Preparando a próxima fase...',
    end: room.message || '🏁 Fim de jogo!',
  }[room.status] || '';
  $('#status').textContent = statusText;
  $('#status').classList.toggle('pulse', !room.paused && ['spinning', 'result', 'talk'].includes(room.status));
  $('#status').classList.toggle('final', room.status === 'end');
  $('#goal').textContent = room.status === 'lobby'
    ? `Vence quem fizer ${room.target_score} ponto${room.target_score > 1 ? 's' : ''}`
    : `Rodada ${room.round} · vence quem fizer ${room.target_score} ponto${room.target_score > 1 ? 's' : ''}`;
  $('#paused').hidden = !room.paused;

  wantedClock = ['', 0, null, false];
  renderWords();
  renderRole();
  renderTalk();
  renderDuel();
  renderTeam();
  syncClock(...wantedClock, !!room.paused);
}

function renderWords() {
  const started = room.status !== 'lobby' && room.word_a && room.word_b;
  $('#words').hidden = !started;
  if (!started) return;
  const myWord = room['word_' + key(me.team)];
  setHTML($('#rival-mask'), maskHTML(rivalWord(), rivalTried()));
  $('#rival-info').textContent = `${letterCount(rivalWord())} letras`;
  $('#my-word').textContent = myWord.toUpperCase();
  setHTML($('#my-word-mask'), maskHTML(myWord, room['tried_' + key(me.team)]));
}

function renderRole() {
  $('#role-card').hidden = room.status === 'lobby';
  $('#role-cover').hidden = roleVisible;
  $('#role-body').hidden = !roleVisible;
  const role = ROLES[me.role] || ROLES.cidadao;
  $('#role-card').className = 'card role-card role-' + me.role;
  $('#role-name').textContent = `${role.emoji} ${role.name}`;
  $('#role-desc').textContent = role.desc;

  let extra = '';
  if (me.role === 'espiao') {
    extra = me.secret
      ? `Letras secretas da palavra rival: <b>${[...me.secret].map((l) => l.toUpperCase()).join(', ')}</b>`
      : 'Você recebe uma letra no começo de cada discussão.';
  }
  if (me.role === 'vidente') {
    extra = me.vision ? `Suas visões: <b>${visionsText(me.vision)}</b>` : 'Use sua visão durante a discussão.';
  }
  if (me.role === 'guardiao') {
    extra = me.shield ? '🛡️ Escudo pronto!' : '🛡️ Escudo já usado nesta rodada.';
  }
  if (me.role === 'impostor') {
    extra = `Você finge ser do <b>${TEAMS[me.team].name}</b>, mas na verdade joga pelo
      <b>${TEAMS[rival(me.team)].name}</b>!<br>
      A palavra que o ${TEAMS[me.team].name} está tentando descobrir é
      <b class="reveal">${esc(rivalWord().toUpperCase())}</b>.
      Despiste o time para que eles não acertem!`;
  }
  if (me.lives <= 0) extra += '<br>☠️ Você está fora desta rodada.';
  $('#role-extra').innerHTML = extra;
}

$('#role-card').addEventListener('click', () => {
  roleVisible = !roleVisible;
  renderRole();
});

function renderTalk() {
  const talking = room.status === 'talk';
  $('#talk').hidden = !talking;
  if (!talking) return;

  wantedClock = [`talk|${room.talk}|${room.talk_seconds}`, room.talk_seconds, $('#talk-timer'), false];
  const alive = me.lives > 0;

  // Vidente: uma visão por discussão
  const canVision = me.role === 'vidente' && alive && me.vision_talk !== room.talk;
  $('#vision').hidden = !canVision;
  if (canVision) {
    document.querySelectorAll('#vision-keyboard .key').forEach((btn) => {
      const l = btn.dataset.letter;
      btn.disabled = me.vision.includes(l) || rivalTried().includes(l);
    });
  }

  // Votação do impostor (só vivos votam e recebem voto)
  const mates = players.filter((p) => p.team === me.team && p.lives > 0);
  const count = {};
  mates.forEach((p) => { if (p.vote) count[p.vote] = (count[p.vote] || 0) + 1; });
  $('#vote-list').innerHTML = mates.filter((p) => p.id !== me.id).map((p) => `
    <button class="vote ${me.vote === p.id ? 'chosen' : ''}" data-vote="${p.id}" ${alive ? '' : 'disabled'}>
      <span>${esc(p.name)}</span><span>${count[p.id] || 0} 🗳️</span>
    </button>`).join('') || '<p class="muted">Ninguém para votar.</p>';
  const needed = Math.floor(mates.length / 2) + 1;
  $('#vote-info').textContent = !alive
    ? 'Você está fora e não pode votar.'
    : `Precisa de ${needed} voto(s) para acusar alguém. Toque de novo para tirar o voto.`;
}

function renderDuel() {
  const dA = players.find((p) => p.id === room.duel_a);
  const dB = players.find((p) => p.id === room.duel_b);
  const showDuel = (room.status === 'duel' || room.status === 'result') && dA && dB;
  $('#duel').hidden = !showDuel;
  if (!showDuel) return;

  const active = room.status === 'duel';
  const turnPlayer = room.turn === 'A' ? dA : dB;
  const myTurn = active && turnPlayer.id === me.id;
  if (active) {
    wantedClock = [`duel|${room.duel}|${room.event_id}|${room.turn_seconds}`, room.turn_seconds, $('#timer'), myTurn];
  }

  $('#dn-a').textContent = dA.name;
  $('#dn-b').textContent = dB.name;
  $('#dh-a').textContent = hearts(dA.lives, room.lives_max);
  $('#dh-b').textContent = hearts(dB.lives, room.lives_max);
  $('#dc-a').classList.toggle('active', active && room.turn === 'A');
  $('#dc-b').classList.toggle('active', active && room.turn === 'B');
  $('#turn').textContent = active
    ? (myTurn ? '👉 É A SUA VEZ!' : `⏳ Vez de ${turnPlayer.name} ${TEAMS[room.turn].emoji}`)
    : '';
  $('#event').textContent = room.event;
  $('#chances').textContent = active ? chancesText(room) : '';

  // Teclado + chute da palavra (só para quem está na vez)
  const pending = guesses.some((g) => g.player_id === me.id && !g.result);
  if (!pending) sending = false;
  $('#my-turn').hidden = !myTurn;
  if (myTurn) {
    setHTML($('#turn-mask'), maskHTML(rivalWord(), rivalTried()));
    const letters = wordLetters(rivalWord());
    document.querySelectorAll('#keyboard .key').forEach((btn) => {
      const l = btn.dataset.letter;
      const tried = rivalTried().includes(l);
      btn.classList.toggle('hit', tried && letters.includes(l));
      btn.classList.toggle('miss', tried && !letters.includes(l));
      btn.disabled = tried || sending || pending;
    });
    $('#word-form button').disabled = sending || pending;
  }

  $('#guess-list').innerHTML = guesses.slice().reverse().map((g) => {
    const p = players.find((x) => x.id === g.player_id);
    const icon = { hit: '✅', win: '🏆', miss: '❌', wrong: '💥', ignored: '⛔' }[g.result] || '⏳';
    const what = g.kind === 'letter' ? `letra <b>${esc(g.guess.toUpperCase())}</b>` : `palavra <b>${esc(g.guess)}</b>`;
    return `<li class="${TEAMS[g.team].cls}">${icon} ${esc(p ? p.name : '?')} chutou ${what}</li>`;
  }).join('');
}

function renderTeam() {
  const myTeam = TEAMS[me.team];
  const mates = players.filter((p) => p.team === me.team);
  $('#team-title').textContent = `${myTeam.emoji} ${myTeam.name} (${mates.length})`;
  $('#team-list').innerHTML = mates.map((p) => `<li class="${p.lives <= 0 ? 'out' : ''}">
      ${esc(p.name)}${p.id === me.id ? ' <small>(você)</small>' : ''}
      <small>${p.lives <= 0 ? '☠️' : '❤️' + p.lives}</small></li>`).join('');
}

// ---------- Ações ----------

function buildKeyboard(el) {
  el.innerHTML = [...ALPHABET]
    .map((l) => `<button type="button" class="key" data-letter="${l.toLowerCase()}">${l}</button>`).join('');
}

async function sendGuess(kind, guess) {
  if (sending || room.status !== 'duel' || room.paused) return;
  sending = true;
  render();
  const { error } = await db.from('guesses').insert({
    room_id: room.id, player_id: me.id, duel: room.duel, team: me.team, kind, guess,
  });
  if (error) {
    sending = false;
    toast('Erro ao enviar. Tente de novo.');
  }
  load();
}

$('#keyboard').addEventListener('click', (e) => {
  const btn = e.target.closest('.key');
  if (btn && !btn.disabled) sendGuess('letter', btn.dataset.letter);
});

$('#word-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const guess = $('#word-input').value.trim();
  if (!guess) return;
  if (!confirm(`Chutar "${guess}"? Se errar, perde 2 vidas!`)) return;
  $('#word-input').value = '';
  sendGuess('word', guess);
});

// Vidente pergunta uma letra
$('#vision-keyboard').addEventListener('click', async (e) => {
  const btn = e.target.closest('.key');
  if (!btn || btn.disabled || room.status !== 'talk' || me.vision_talk === room.talk) return;
  const l = btn.dataset.letter;
  const has = wordLetters(rivalWord()).includes(l);
  await db.from('players')
    .update({ vision: me.vision + l + (has ? '+' : '-'), vision_talk: room.talk })
    .eq('id', me.id);
  toast(has ? `🔮 A letra ${l.toUpperCase()} ESTÁ na palavra!` : `🔮 A letra ${l.toUpperCase()} NÃO está na palavra.`);
  roleVisible = true;
  load();
});

// Votar (ou tirar o voto)
$('#vote-list').addEventListener('click', async (e) => {
  const btn = e.target.closest('.vote');
  if (!btn || btn.disabled || room.status !== 'talk') return;
  const target = me.vote === btn.dataset.vote ? null : btn.dataset.vote;
  await db.from('players').update({ vote: target }).eq('id', me.id);
  load();
});

// ---------- Início ----------

(async function start() {
  if (!configOk()) {
    $('#join-error').textContent = 'Configure o Supabase no arquivo js/config.js.';
    return;
  }
  const params = new URLSearchParams(location.search);
  if (params.get('msg')) $('#join-error').textContent = params.get('msg');
  if (params.get('sala')) $('#join-code').value = params.get('sala').toUpperCase();

  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
  if (saved) {
    const { data: player } = await db.from('players').select('*').eq('id', saved.id).maybeSingle();
    if (player) return enterGame(player);
    localStorage.removeItem(STORAGE_KEY);
  }
})();
