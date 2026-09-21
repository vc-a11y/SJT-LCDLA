(function () {
  const { h, api, bandeau } = window.CDA;
  const app = document.getElementById('app');
  const token = location.pathname.split('/')[2] || '';
  const KEY = 'cda:test:' + token;

  let questions = [];
  let firstName = '';
  let idx = 0;
  let phase = 0;
  let sel = null;
  let best = null;
  let answers = [];

  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ idx, answers })); } catch { /* stockage indisponible */ } };
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; } };
  const clear = () => { try { localStorage.removeItem(KEY); } catch { /* rien */ } };

  function shell(...content) {
    app.replaceChildren(bandeau('Test savoir-être'), h('main', { class: 'narrow' }, ...content));
  }

  function message(titre, texte) {
    shell(h('h1', { text: titre }), h('p', { style: 'margin-top:16px', text: texte }));
  }

  async function init() {
    let info;
    try {
      info = await api('/api/test/' + encodeURIComponent(token));
    } catch (e) {
      return message('Lien invalide', 'Ce lien ne fonctionne pas. Vérifiez que vous l\'avez copié en entier, ou demandez un nouveau lien à votre responsable de formation.');
    }
    firstName = info.firstName;
    if (info.status === 'completed') {
      clear();
      return message('Test déjà terminé', 'Vous avez déjà passé ce test. Votre responsable de formation reviendra vers vous.');
    }
    welcome(info);
  }

  function welcome(info) {
    const box = h('input', { type: 'checkbox', id: 'consent' });
    const err = h('p', { class: 'erreur', role: 'alert' });
    const btn = h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
      if (!box.checked) { err.textContent = 'Cochez la case pour commencer'; box.focus(); return; }
      err.textContent = '';
      btn.disabled = true;
      try {
        const r = await api('/api/test/' + encodeURIComponent(token) + '/start', { method: 'POST', body: { consent: true } });
        questions = r.questions;
        const saved = load();
        const ok = saved && Array.isArray(saved.answers) && saved.answers.length <= questions.length &&
          saved.answers.every((a, i) => a && a.id === questions[i].id);
        answers = ok ? saved.answers : [];
        idx = answers.length;
        phase = 0; sel = null; best = null;
        idx >= questions.length ? submit() : question();
      } catch (e) {
        btn.disabled = false;
        err.textContent = e.message;
      }
    } }, 'Commencer le test');
    box.addEventListener('change', () => { err.textContent = ''; });

    shell(
      h('h1', { text: 'Bonjour ' + firstName }),
      h('p', { style: 'margin:16px 0 20px;font-size:18px', text: 'Ce test montre comment vous réagissez dans des situations de chantier. Il n\'y a pas de piège : répondez comme vous feriez vraiment.' }),
      h('ul', { class: 'liste-simple' },
        h('li', { text: `${info.questionCount} situations, environ 15 minutes.` }),
        h('li', { text: 'Pour chaque situation, vous choisissez la meilleure réaction, puis la moins adaptée.' }),
        h('li', { text: 'Il n\'est pas nécessaire de connaître un métier. Vous pouvez le faire sur votre téléphone.' }),
        h('li', { text: 'Faites-le seul, au calme, en une seule fois.' })
      ),
      h('div', { class: 'consent' }, box,
        h('label', { for: 'consent', text: 'J\'accepte que mes réponses et mon résultat soient conservés par Les clés de l\'Atelier, vus par mes responsables de formation, et, si mon profil est validé, transmis à des entreprises du bâtiment. Je peux demander la suppression de mes données à contact@lesclesdelatelier.fr.' })
      ),
      err,
      h('div', { class: 'actions' }, btn)
    );
  }

  function question(keep) {
    const q = questions[idx];
    const pct = Math.round(((idx + (phase ? 0.5 : 0)) / questions.length) * 100);
    const titre = h('p', { class: 'situation', tabindex: '-1', text: q.text });
    const err = h('p', { class: 'erreur', role: 'alert' });

    const opts = q.options.map((o, n) => {
      const isBest = phase === 1 && o.i === best;
      const btn = h('button', {
        type: 'button',
        class: 'option' + (isBest ? ' choisie' : ''),
        'aria-pressed': String(sel === o.i),
        disabled: isBest ? true : null,
        onclick: () => {
          const y = window.scrollY;
          sel = o.i; err.textContent = ''; question(true);
          window.scrollTo(0, y);
          document.querySelector('.option[aria-pressed=true]')?.focus({ preventScroll: true });
        },
      },
        h('span', { class: 'lettre', text: String.fromCharCode(65 + n) }),
        h('span', { text: o.text }),
        isBest ? h('span', { class: 'marque', text: 'Votre meilleure réponse' }) : null
      );
      return btn;
    });

    const last = idx === questions.length - 1;
    const next = h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
      if (sel === null) { err.textContent = 'Choisissez une réponse pour continuer'; return; }
      if (phase === 0) { best = sel; sel = null; phase = 1; question(); return; }
      answers.push({ id: q.id, best, worst: sel });
      idx++; phase = 0; sel = null; best = null;
      save();
      idx >= questions.length ? submit() : question();
    } }, phase === 0 ? 'Valider' : last ? 'Terminer le test' : 'Valider');

    shell(
      h('div', { class: 'compteur', text: `Situation ${idx + 1} sur ${questions.length}` }),
      h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct) }, h('i', { style: `width:${pct}%` })),
      titre,
      h('div', { class: 'etapes' },
        h('div', { class: 'etape ' + (phase === 0 ? 'actif' : 'fait'), text: '1. La meilleure réaction' }),
        h('div', { class: 'etape ' + (phase === 1 ? 'actif' : ''), text: '2. La moins adaptée' })
      ),
      h('div', { role: 'group', 'aria-label': phase === 0 ? 'Choisissez la meilleure réaction' : 'Choisissez la réaction la moins adaptée' }, opts),
      err,
      h('div', { class: 'actions' }, next)
    );
    if (!keep) { window.scrollTo(0, 0); titre.focus({ preventScroll: true }); }
  }

  async function submit() {
    shell(h('h1', { text: 'Envoi de vos réponses…' }));
    try {
      await api('/api/test/' + encodeURIComponent(token) + '/submit', { method: 'POST', body: { answers } });
      clear();
      shell(
        h('h1', { text: 'Merci ' + firstName }),
        h('p', { style: 'margin-top:16px;font-size:18px', text: 'Votre test est terminé. Votre responsable de formation a reçu vos réponses et reviendra vers vous pour un entretien.' }),
        h('p', { class: 'muted', text: 'Vous pouvez fermer cette page.' })
      );
    } catch (e) {
      const retry = h('button', { class: 'btn btn-primary', type: 'button', onclick: submit }, 'Réessayer');
      shell(h('h1', { text: 'L\'envoi a échoué' }), h('p', { style: 'margin-top:16px', text: e.message + ' Vos réponses sont conservées sur cet appareil.' }), h('div', { class: 'actions' }, retry));
    }
  }

  init();
})();
