// Roleta desenhada em <canvas>

class Wheel {
  constructor(canvas, colors) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.colors = colors;   // tons do time
    this.names = [];
    this.highlight = -1;    // fatia do sorteado
    this.rotation = 0;
    this.busy = false;
    this.key = '';
    this.draw();
    // redesenha quando a fonte do jogo terminar de carregar
    if (document.fonts) document.fonts.ready.then(() => { if (!this.busy) this.draw(); });
  }

  setNames(names, highlight = -1) {
    if (this.busy) return;
    const key = names.join('|') + '#' + highlight;
    if (key === this.key) return;
    this.key = key;
    this.names = names;
    this.highlight = highlight;
    this.draw();
  }

  draw() {
    const { ctx, canvas, names } = this;
    const size = canvas.width;
    const c = size / 2;
    const radius = c - 14;
    ctx.clearRect(0, 0, size, size);

    if (!names.length) {
      ctx.fillStyle = '#e2e5f0';
      ctx.beginPath(); ctx.arc(c, c, radius, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#5d5a7a';
      ctx.font = '800 18px "Bricolage Grotesque", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Sem jogadores', c, c + 6);
      return;
    }

    const seg = (Math.PI * 2) / names.length;
    const fontSize = Math.max(11, Math.min(20, 220 / names.length));

    names.forEach((name, i) => {
      const start = this.rotation + i * seg - Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(c, c);
      ctx.arc(c, c, radius, start, start + seg);
      ctx.closePath();
      ctx.fillStyle = i === this.highlight ? '#ffd23f' : this.colors[i % this.colors.length];
      ctx.fill();
      ctx.strokeStyle = '#1e1b3a';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.save();
      ctx.translate(c, c);
      ctx.rotate(start + seg / 2);
      ctx.textAlign = 'right';
      ctx.fillStyle = i === this.highlight ? '#1e1b3a' : '#fff';
      ctx.font = `800 ${fontSize}px "Bricolage Grotesque", sans-serif`;
      const label = name.length > 14 ? name.slice(0, 13) + '…' : name;
      ctx.fillText(label, radius - 12, fontSize / 3);
      ctx.restore();
    });

    // miolo
    ctx.beginPath();
    ctx.arc(c, c, 22, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.strokeStyle = '#1e1b3a';
    ctx.lineWidth = 3;
    ctx.stroke();

    // ponteiro no topo
    ctx.beginPath();
    ctx.moveTo(c - 14, 2);
    ctx.lineTo(c + 14, 2);
    ctx.lineTo(c, 30);
    ctx.closePath();
    ctx.fillStyle = '#1e1b3a';
    ctx.fill();
  }

  // Gira e para no índice escolhido
  spinTo(names, index, duration = 4500) {
    this.names = names;
    this.highlight = -1;
    this.key = '';
    this.busy = true;

    const full = Math.PI * 2;
    const seg = full / names.length;
    let target = -(index + 0.5) * seg + (Math.random() - 0.5) * seg * 0.6;
    while (target < this.rotation + full * 5) target += full;

    const from = this.rotation;
    const t0 = performance.now();

    return new Promise((resolve) => {
      let done = false;
      const end = () => {
        if (done) return;
        done = true;
        this.rotation = target % full;
        this.highlight = index;
        this.draw();
        this.busy = false;
        resolve();
      };
      const step = (now) => {
        if (done) return;
        const t = Math.min(1, (now - t0) / duration);
        const eased = 1 - Math.pow(1 - t, 4);
        this.rotation = from + (target - from) * eased;
        this.draw();
        if (t < 1) return requestAnimationFrame(step);
        end();
      };
      requestAnimationFrame(step);
      // Com a aba escondida o navegador para a animação; isto garante que a roleta termina
      setTimeout(end, duration + 300);
    });
  }
}
