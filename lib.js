(function () {
  const h = (tag, attrs, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
    for (const kid of kids.flat()) {
      if (kid === null || kid === undefined || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  };

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      method: opts.method || 'GET',
      headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      credentials: 'same-origin',
    });
    let data = null;
    try { data = await res.json(); } catch { /* corps vide */ }
    if (!res.ok) {
      const err = new Error((data && data.error) || 'Une erreur est survenue');
      err.status = res.status;
      throw err;
    }
    return data;
  }

  const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '');
  const fmtDateShort = (iso) => (iso ? new Date(iso).toLocaleDateString('fr-FR') : '');

  function bandeau(titre, droite) {
    return h('header', {},
      h('div', { class: 'bandeau' },
        h('img', { src: '/img/logo-256.png', alt: 'Les clés de l\'Atelier', width: 88, height: 88 }),
        h('div', { class: 'titre', text: titre }),
        droite ? h('div', { class: 'droite' }, droite) : null
      ),
      h('div', { class: 'filet' })
    );
  }

  const svgNS = (s) => s;

  function radarSVG(comps, values, opts = {}) {
    const W = 460, H = 320, cx = 230, cy = 160, R = 100, N = comps.length;
    const pt = (i, r) => {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / N;
      return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    };
    const f = (n) => n.toFixed(1);
    let g = '';
    [0.25, 0.5, 0.75, 1].forEach((k) => {
      g += `<polygon points="${comps.map((_, i) => pt(i, R * k).map(f).join(',')).join(' ')}" fill="none" stroke="#b4b6b6" stroke-width="${k === 1 ? 1.2 : 0.6}"/>`;
    });
    const seuil = opts.threshold;
    if (seuil) {
      g += `<polygon points="${comps.map((_, i) => pt(i, (R * seuil) / 100).map(f).join(',')).join(' ')}" fill="none" stroke="#636565" stroke-width="1" stroke-dasharray="4 4"/>`;
    }
    comps.forEach((c, i) => {
      const p = pt(i, R);
      g += `<line x1="${cx}" y1="${cy}" x2="${f(p[0])}" y2="${f(p[1])}" stroke="#b4b6b6" stroke-width="0.6"/>`;
      const l = pt(i, R + 26);
      const anchor = l[0] < cx - 8 ? 'end' : l[0] > cx + 8 ? 'start' : 'middle';
      g += `<text x="${f(l[0])}" y="${f(l[1] + 4)}" text-anchor="${anchor}" font-size="16" font-family="Jost, sans-serif" fill="#2b2e2e">${c.short}</text>`;
    });
    const pts = values.map((v, i) => pt(i, (R * Math.max(v, 2)) / 100));
    g += `<polygon points="${pts.map((p) => p.map(f).join(',')).join(' ')}" fill="#f2b705" fill-opacity="0.45" stroke="#2b2e2e" stroke-width="2" stroke-linejoin="round"/>`;
    pts.forEach((p) => { g += `<circle cx="${f(p[0])}" cy="${f(p[1])}" r="3.5" fill="#2b2e2e"/>`; });
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Radar des six compétences" style="max-width:${opts.max || 440}px;display:block;margin:0 auto">${g}</svg>`;
  }

  let macaronCount = 0;
  function macaronSVG(level, size = 140) {
    const id = 'mc' + macaronCount++;
    const excellence = level === 'excellence';
    const disc = excellence ? '#2b2e2e' : '#f2b705';
    const ink = excellence ? '#f2b705' : '#2b2e2e';
    const label = excellence ? 'EXCELLENCE · SAVOIR-ÊTRE · LES CLÉS DE L\'ATELIER · ' : 'SAVOIR-ÊTRE · LES CLÉS DE L\'ATELIER · SAVOIR-ÊTRE · ';
    return `<svg class="macaron" viewBox="0 0 140 140" width="${size}" height="${size}" role="img" aria-label="Macaron savoir-être${excellence ? ' excellence' : ''}">
      <defs><path id="${id}" d="M70,70 m-46,0 a46,46 0 1,1 92,0 a46,46 0 1,1 -92,0"/></defs>
      <circle cx="70" cy="70" r="67" fill="${disc}"/>
      <circle cx="70" cy="70" r="62" fill="none" stroke="${ink}" stroke-width="1.2"/>
      <circle cx="70" cy="70" r="39" fill="none" stroke="${ink}" stroke-width="1.2"/>
      <text font-family="Jost, sans-serif" font-weight="500" font-size="9.5" fill="${ink}"><textPath href="#${id}" textLength="286" lengthAdjust="spacing">${label}</textPath></text>
      <g fill="none" stroke="${ink}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">
        <circle cx="70" cy="56" r="12"/>
        <path d="M63,67 L60,98 L80,98 L77,67"/>
        <path d="M64,60 Q70,66 76,60" stroke-width="1.6"/>
      </g>
      <g fill="${ink}"><circle cx="65.5" cy="52.5" r="1.4"/><circle cx="74.5" cy="52.5" r="1.4"/></g>
    </svg>`;
  }

  function barres(comps, byPct, rules) {
    return h('div', { class: 'barres' }, comps.map((c) => {
      const v = byPct[c.id];
      const cls = v >= rules.strong ? 'fort' : v < rules.weak ? 'faible' : '';
      return h('div', { class: 'ligne' },
        h('span', { text: c.label }),
        h('div', { class: 'piste' }, h('i', { class: cls, style: `width:${v}%` })),
        h('span', { class: 'val', text: v + ' %' })
      );
    }));
  }

  window.CDA = { h, api, fmtDate, fmtDateShort, bandeau, radarSVG, macaronSVG, barres, svgNS };
})();
