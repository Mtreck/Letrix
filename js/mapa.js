// Página "Como jogar": trilha tracejada que liga as paradas + modo apresentação
// Teclas: → / Espaço / PageDown avançam · ← / PageUp voltam · T mostra tudo

const map = document.getElementById('map');
const svg = document.getElementById('trail');
const stops = [...document.querySelectorAll('.stop')];
const pins = stops.map((s) => s.querySelector('.pin'));
const token = document.getElementById('token');
const startMark = document.getElementById('start');
const label = document.getElementById('step-label');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let step = 0;            // parada atual
let showAll = false;
let marks = [];          // comprimento da trilha até cada parada
let tokenAt = 0;         // posição atual do barquinho (comprimento)
let anim = null;

const bg = document.getElementById('trail-bg');
const done = document.getElementById('trail-done');
const reveal = document.getElementById('trail-reveal');

function center(el) {
  const m = map.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return { x: r.left - m.left + r.width / 2, y: r.top - m.top + r.height / 2 };
}

// Monta a trilha com curvas em S entre uma parada e a próxima
function buildTrail() {
  const w = map.clientWidth;
  const h = map.clientHeight;
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);

  const start = center(startMark);
  const points = [start, ...pins.map(center)];
  let d = `M ${start.x} ${start.y}`;
  const prefixes = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const k = (b.y - a.y) * 0.6;
    d += ` C ${a.x} ${a.y + k}, ${b.x} ${b.y - k}, ${b.x} ${b.y}`;
    prefixes.push(d);
  }
  [bg, done, reveal].forEach((p) => p.setAttribute('d', d));

  // mede o comprimento até cada alfinete
  const probe = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  svg.appendChild(probe);
  marks = prefixes.map((pd) => { probe.setAttribute('d', pd); return probe.getTotalLength(); });
  probe.remove();

  tokenAt = showAll ? marks[marks.length - 1] : marks[step];
  drawProgress(tokenAt);
}

function drawProgress(len) {
  const total = bg.getTotalLength();
  reveal.style.strokeDasharray = `${len} ${total + 10}`;
  const p = bg.getPointAtLength(len);
  token.style.transform = `translate(${p.x}px, ${p.y}px)`;
}

// Leva o barquinho pela trilha até o comprimento pedido
function sailTo(len) {
  cancelAnimationFrame(anim);
  const from = tokenAt;
  if (reduceMotion || Math.abs(len - from) < 1) {
    tokenAt = len;
    return drawProgress(len);
  }
  const duration = Math.min(1800, 500 + Math.abs(len - from) * 1.2);
  const t0 = performance.now();
  const frame = (now) => {
    const t = Math.min(1, (now - t0) / duration);
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    tokenAt = from + (len - from) * e;
    drawProgress(tokenAt);
    if (t < 1) anim = requestAnimationFrame(frame);
  };
  anim = requestAnimationFrame(frame);
}

function render(scroll = true) {
  stops.forEach((s, i) => {
    s.classList.toggle('fog', !showAll && i > step);
    s.classList.toggle('done', showAll || i < step);
    s.classList.toggle('current', !showAll && i === step);
  });
  document.body.classList.toggle('all', showAll);
  label.textContent = `${step + 1} de ${stops.length}`;
  document.getElementById('show-all').textContent = showAll ? 'Modo apresentação' : 'Ver tudo';
  if (!marks.length) return;
  sailTo(showAll ? marks[marks.length - 1] : marks[step]);
  if (scroll && !showAll) {
    stops[step].scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
  }
}

function go(i) {
  showAll = false;
  step = Math.max(0, Math.min(stops.length - 1, i));
  render();
}

document.getElementById('next').addEventListener('click', () => go(step + 1));
document.getElementById('prev').addEventListener('click', () => go(step - 1));
document.getElementById('show-all').addEventListener('click', () => {
  showAll = !showAll;
  render(!showAll);
});
pins.forEach((pin, i) => pin.addEventListener('click', () => go(i)));

document.addEventListener('keydown', (e) => {
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); go(step + 1); }
  if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) { e.preventDefault(); go(step - 1); }
  if (e.key === 'Home') { e.preventDefault(); go(0); }
  if (e.key === 'End') { e.preventDefault(); go(stops.length - 1); }
  if (e.key.toLowerCase() === 't') { showAll = !showAll; render(!showAll); }
});

// Aberta numa aba nova a partir do painel: "voltar" fecha a aba, para não abrir um segundo painel
// (dois painéis abertos na mesma sala conferem as jogadas em dobro)
document.getElementById('back').addEventListener('click', (e) => {
  if (history.length <= 1) {
    e.preventDefault();
    window.close();
  }
});

// Recalcula a trilha quando o tamanho muda (janela, fonte carregada, etc.)
let resizeTimer = null;
new ResizeObserver(() => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(buildTrail, 60);
}).observe(map);
if (document.fonts) document.fonts.ready.then(buildTrail);

render(false);
buildTrail();
