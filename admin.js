(function () {
  const { h, api, fmtDate, fmtDateShort, bandeau, radarSVG, macaronSVG, barres } = window.CDA;
  const app = document.getElementById('app');

  let meta = null;
  let me = null;
  let list = [];
  let filter = 'all';
  let freshLink = null;
  let showForm = false;

  const VERDICT = {
    excellence: ['Excellence', 'or'],
    atteint: ['Seuil atteint', 'ok'],
    non_atteint: ['Seuil non atteint', 'ko'],
    alerte: ['Alerte', 'warn'],
  };
  const STATUS = { invited: 'Lien envoyé', started: 'En cours', completed: 'Terminé' };
  const DECISION = {
    granted: ['Macaron accordé', 'ok'],
    deferred: ['Macaron différé', 'warn'],
    refused: ['Macaron refusé', 'ko'],
  };

  const svgBox = (markup) => {
    const d = h('div');
    d.innerHTML = markup;
    return d;
  };
  const pill = (text, kind) => h('span', { class: 'pill' + (kind ? ' ' + kind : ''), text });
  const testUrl = (t) => location.origin + '/t/' + t;
  const ficheUrl = (s) => location.origin + '/f/' + s;

  // Ouvre un brouillon Gmail (compte Google) plutôt que le client mail par défaut (ex. Outlook).
  const gmailCompose = ({ to, subject, body }) =>
    `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to || '')}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  const reminderMs = () => Math.max(1, (meta && meta.rules && meta.rules.reminderDays) || 2) * 86400000;
  const isReminderDue = (c) => c.status !== 'completed' &&
    (Date.now() - new Date(c.lastReminderAt || c.createdAt).getTime()) > reminderMs();
  const reminderEmail = (c) => {
    const url = testUrl(c.token);
    return {
      to: c.email,
      subject: 'Rappel : votre test savoir-être – Les clés de l\'Atelier',
      body: `Bonjour ${c.firstName},\n\nPetit rappel : le test de savoir-être que nous vous avons envoyé est toujours disponible. Il prend environ 15 minutes, sur téléphone ou ordinateur.\n\nVotre lien personnel : ${url}\n\nMerci de le faire seul, au calme, en une seule fois.\n\nÀ bientôt,\n${me.name}\nLes clés de l'Atelier · 09 50 00 60 80`,
    };
  };
  async function sendReminder(c, after) {
    window.open(gmailCompose(reminderEmail(c)), '_blank', 'noopener');
    try {
      await api(`/api/admin/candidates/${c.id}/remind`, { method: 'POST' });
      await refresh();
    } catch { /* le brouillon Gmail s'est quand même ouvert */ }
    if (after) after();
  }

  async function copy(text, btn) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const t = h('textarea', { style: 'position:fixed;opacity:0' });
      t.value = text;
      document.body.append(t);
      t.select();
      document.execCommand('copy');
      t.remove();
    }
    const old = btn.textContent;
    btn.textContent = 'Copié';
    setTimeout(() => (btn.textContent = old), 1600);
  }

  function frame(...content) {
    const droite = me
      ? [
          h('span', { text: me.name }),
          h('button', { class: 'btn btn-sm', type: 'button', onclick: async () => {
            await api('/api/admin/logout', { method: 'POST' });
            me = null;
            route();
          } }, 'Déconnexion'),
        ]
      : null;
    app.replaceChildren(bandeau('Espace responsables de formation', droite), h('main', { class: 'wrap' }, ...content));
  }

  // ---------- Connexion ----------
  function login() {
    const name = h('input', { type: 'text', id: 'n', autocomplete: 'username', required: true });
    const pwd = h('input', { type: 'password', id: 'p', autocomplete: 'current-password', required: true });
    const err = h('p', { class: 'erreur', role: 'alert' });
    const form = h('form', { onsubmit: async (e) => {
      e.preventDefault();
      err.textContent = '';
      try {
        const r = await api('/api/admin/login', { method: 'POST', body: { name: name.value, password: pwd.value } });
        me = { name: r.name };
        await boot();
      } catch (ex) {
        err.textContent = ex.message;
      }
    } },
      h('div', { class: 'field' }, h('label', { for: 'n', text: 'Votre prénom' }), name),
      h('div', { class: 'field' }, h('label', { for: 'p', text: 'Mot de passe' }), pwd),
      err,
      h('div', { class: 'actions' }, h('button', { class: 'btn btn-primary', type: 'submit' }, 'Se connecter'))
    );
    app.replaceChildren(bandeau('Espace responsables de formation'),
      h('main', { class: 'narrow' }, h('h1', { text: 'Connexion' }), h('div', { class: 'carte', style: 'margin-top:20px' }, form)));
    name.focus();
  }

  // ---------- Tableau de bord ----------
  function kpis() {
    const done = list.filter((c) => c.status === 'completed');
    const avg = done.length ? Math.round(done.reduce((s, c) => s + c.pct, 0) / done.length) : null;
    const granted = list.filter((c) => c.decision === 'granted').length;
    const todo = done.filter((c) => !c.decision).length;
    const toRemind = list.filter(isReminderDue).length;
    const k = (v, l) => h('div', { class: 'kpi' }, h('b', { text: v }), h('span', { text: l }));
    return h('div', { class: 'kpis' },
      k(list.length, 'candidats'),
      k(done.length, 'tests terminés'),
      k(avg === null ? '–' : avg, 'score moyen sur 100'),
      k(granted, 'macarons accordés'),
      k(todo, 'à décider'),
      k(toRemind, 'à relancer')
    );
  }

  function newForm() {
    const first = h('input', { type: 'text', id: 'fn', required: true, autocomplete: 'off' });
    const last = h('input', { type: 'text', id: 'ln', required: true, autocomplete: 'off' });
    const mail = h('input', { type: 'email', id: 'em', autocomplete: 'off', placeholder: 'prenom.nom@exemple.fr' });
    const form = h('input', { type: 'text', id: 'fo', placeholder: 'Plaquiste, Peintre, Plombier…' });
    const err = h('p', { class: 'erreur', role: 'alert' });
    return h('form', { class: 'carte', style: 'margin-bottom:20px', onsubmit: async (e) => {
      e.preventDefault();
      err.textContent = '';
      try {
        const c = await api('/api/admin/candidates', { method: 'POST', body: { firstName: first.value, lastName: last.value, email: mail.value, formation: form.value } });
        freshLink = c;
        showForm = false;
        await refresh();
        dashboard();
      } catch (ex) {
        err.textContent = ex.message;
      }
    } },
      h('h2', { class: 'bloc-titre', text: 'Nouveau candidat' }),
      h('div', { class: 'grid2' },
        h('div', { class: 'field' }, h('label', { for: 'fn', text: 'Prénom' }), first),
        h('div', { class: 'field' }, h('label', { for: 'ln', text: 'Nom' }), last),
        h('div', { class: 'field' }, h('label', { for: 'em', text: 'E-mail (facultatif)' }), mail),
        h('div', { class: 'field' }, h('label', { for: 'fo', text: 'Formation visée (facultatif)' }), form)
      ),
      err,
      h('div', { class: 'actions' },
        h('button', { class: 'btn btn-primary', type: 'submit' }, 'Créer le lien de test'),
        h('button', { class: 'btn', type: 'button', onclick: () => { showForm = false; dashboard(); } }, 'Annuler'))
    );
  }

  function linkPanel(c) {
    const url = testUrl(c.token);
    const subject = 'Votre test savoir-être – Les clés de l\'Atelier';
    const body = `Bonjour ${c.firstName},\n\nDans le cadre de votre candidature, nous vous invitons à passer un court test de savoir-être : 24 situations de chantier, environ 15 minutes, sur téléphone ou ordinateur.\n\nVotre lien personnel : ${url}\n\nMerci de le faire seul, au calme, en une seule fois.\n\nÀ bientôt,\n${me.name}\nLes clés de l'Atelier · 09 50 00 60 80`;
    const gmail = gmailCompose({ to: c.email, subject, body });
    const input = h('input', { type: 'text', readonly: true, value: url, 'aria-label': 'Lien du test', onfocus: (e) => e.target.select() });
    const cp = h('button', { class: 'btn', type: 'button', onclick: () => copy(url, cp) }, 'Copier');
    return h('div', { class: 'encart ok' },
      h('strong', { text: `Lien prêt pour ${c.firstName} ${c.lastName}` }),
      h('p', { class: 'small', text: 'Ce lien est personnel et ne fonctionne qu\'une fois le test terminé.' }),
      h('div', { class: 'lien-box' }, input, cp),
      h('div', { class: 'actions' },
        h('a', { class: 'btn btn-sm', href: gmail, target: '_blank', rel: 'noopener' }, 'Ouvrir un brouillon Gmail'),
        h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { freshLink = null; dashboard(); } }, 'Fermer'))
    );
  }

  function statusCell(c) {
    if (c.status !== 'completed') return pill(STATUS[c.status]);
    return pill(...(VERDICT[c.verdict] || ['Terminé']));
  }

  function dashboard() {
    const rows = list.filter((c) => {
      if (filter === 'todo') return c.status === 'completed' && !c.decision;
      if (filter === 'granted') return c.decision === 'granted';
      if (filter === 'progress') return c.status !== 'completed';
      if (filter === 'reminder') return isReminderDue(c);
      return true;
    });

    const sel = h('select', { 'aria-label': 'Filtrer', style: 'width:auto', onchange: (e) => { filter = e.target.value; dashboard(); } },
      [['all', 'Tous les candidats'], ['todo', 'À décider'], ['granted', 'Macaron accordé'], ['progress', 'Test à passer ou en cours'], ['reminder', 'À relancer']]
        .map(([v, t]) => h('option', { value: v, selected: v === filter ? true : null, text: t })));

    const table = rows.length
      ? h('div', { class: 'tableau-scroll' }, h('table', { class: 'liste' },
          h('thead', {}, h('tr', {}, ['Candidat', 'Formation', 'Résultat', 'Score', 'Décision', 'Date'].map((t) => h('th', { text: t })))),
          h('tbody', {}, rows.map((c) => {
            const d = DECISION[c.decision];
            const remind = isReminderDue(c);
            return h('tr', { class: 'clic', onclick: () => (location.hash = '#/c/' + c.id) },
              h('td', {}, h('a', { class: 'nom', href: '#/c/' + c.id, text: `${c.firstName} ${c.lastName}` })),
              h('td', { text: c.formation || '–' }),
              h('td', {}, statusCell(c),
                c.tooFast ? h('span', { class: 'small muted', style: 'margin-left:8px', text: 'Très rapide' }) : null,
                remind ? h('span', { style: 'margin-left:8px' }, pill('À relancer', 'warn')) : null,
                remind && c.email ? h('button', {
                  type: 'button', class: 'btn btn-sm', style: 'margin-left:8px',
                  onclick: (e) => { e.stopPropagation(); sendReminder(c, dashboard); },
                }, 'Relancer') : null),
              h('td', { text: c.pct === null ? '–' : c.pct + '/100' }),
              h('td', {}, d ? pill(...d) : c.status === 'completed' ? pill('À décider', 'warn') : '–'),
              h('td', { class: 'small muted', text: fmtDateShort(c.completedAt || c.createdAt) })
            );
          }))))
      : h('div', { class: 'carte' }, h('h2', { text: list.length ? 'Aucun candidat dans ce filtre' : 'Créez le premier lien de test' }),
          h('p', { class: 'muted', style: 'margin-top:6px', text: 'Chaque candidat reçoit un lien personnel. Son résultat apparaît ici dès qu\'il a terminé.' }));

    frame(
      h('h1', { text: 'Candidats' }),
      kpis(),
      freshLink ? linkPanel(freshLink) : null,
      showForm ? newForm() : null,
      h('div', { class: 'barre-outils' },
        sel,
        h('div', { class: 'espace' }),
        h('a', { class: 'btn', href: '/api/admin/export.csv' }, 'Exporter en CSV'),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => { showForm = true; freshLink = null; dashboard(); document.getElementById('fn')?.focus(); } }, 'Nouveau candidat')
      ),
      table
    );
  }

  // ---------- Fiche candidat ----------
  async function detail(id) {
    frame(h('p', { class: 'muted', text: 'Chargement…' }));
    let c;
    try {
      c = await api('/api/admin/candidates/' + id);
    } catch (e) {
      return frame(h('a', { class: 'retour', href: '#/' }, '← Retour aux candidats'), h('h1', { text: 'Candidat introuvable' }));
    }
    const done = c.status === 'completed';
    const r = c.result;
    const comps = meta.competences;
    const rules = meta.rules;
    const dec = DECISION[c.decision];

    const macaron = c.decision === 'granted'
      ? svgBox(macaronSVG(r.verdict === 'excellence' ? 'excellence' : 'standard', 120))
      : null;

    const head = h('div', { class: 'entete-fiche', style: 'margin-bottom:24px' },
      h('div', {},
        h('h1', { text: `${c.firstName} ${c.lastName}` }),
        h('p', { class: 'muted', style: 'margin-top:6px', text: [c.formation, c.email, `Créé le ${fmtDate(c.createdAt)}`, `par ${c.trainer}`, c.attempts > 1 ? `${c.attempts}e passage` : null].filter(Boolean).join(' · ') }),
        h('div', { style: 'margin-top:10px;display:flex;gap:8px;flex-wrap:wrap' }, pill(STATUS[c.status]), dec ? pill(...dec) : done ? pill('À décider', 'warn') : null)
      ),
      macaron
    );

    const blocs = [];

    if (!done) {
      const url = testUrl(c.token);
      const input = h('input', { type: 'text', readonly: true, value: url, 'aria-label': 'Lien du test', onfocus: (e) => e.target.select() });
      const cp = h('button', { class: 'btn', type: 'button', onclick: () => copy(url, cp) }, 'Copier');
      const remind = isReminderDue(c);
      const relanceBtn = h('a', { class: 'btn btn-sm', href: '#', onclick: (e) => { e.preventDefault(); sendReminder(c, () => detail(c.id)); } }, 'Ouvrir un brouillon Gmail de relance');
      blocs.push(h('div', { class: 'carte' },
        h('h2', { class: 'bloc-titre', text: c.status === 'started' ? 'Test en cours' : 'En attente du candidat' }),
        h('p', { class: 'muted', text: 'Le résultat s\'affichera ici dès que le candidat aura terminé le test.' }),
        h('div', { class: 'lien-box' }, input, cp),
        c.reminderCount ? h('p', { class: 'small muted', style: 'margin-top:10px', text: `${c.reminderCount} relance(s) envoyée(s)${c.lastReminderAt ? ', la dernière le ' + fmtDate(c.lastReminderAt) : ''}.` }) : null,
        remind && c.email ? h('div', { class: 'encart warn', style: 'margin-top:14px' },
          h('strong', { text: 'Candidat à relancer' }),
          h('p', { class: 'small', text: `Aucun test terminé depuis plus de ${meta.rules.reminderDays} jour(s). Ce candidat pourra être relancé à nouveau si besoin.` }),
          h('div', { class: 'actions' }, relanceBtn)) : null,
        !c.email && c.status !== 'completed' ? h('p', { class: 'small muted', style: 'margin-top:10px', text: 'Aucun e-mail enregistré pour ce candidat : ajoutez-en un pour pouvoir le relancer automatiquement depuis ici.' }) : null
      ));
    } else {
      const v = VERDICT[r.verdict];
      const enc = r.verdict === 'alerte' ? 'warn' : r.verdict === 'non_atteint' ? 'ko' : 'ok';
      const titreEnc = {
        alerte: 'Alerte : à traiter en entretien avant toute décision',
        non_atteint: `Seuil de ${rules.threshold} non atteint`,
        atteint: 'Seuil atteint',
        excellence: 'Seuil atteint, niveau excellence',
      }[r.verdict];

      blocs.push(h('div', { class: 'carte' },
        h('div', { class: 'deux-col' },
          h('div', {},
            h('div', { class: 'gros-score' }, String(r.pct), h('small', { text: ' / 100' })),
            h('div', { class: 'encart ' + enc, style: 'margin-top:14px' }, h('strong', { text: titreEnc }),
              h('span', { class: 'small', text: `Seuil ${rules.threshold}, excellence à partir de ${rules.excellence}.` })),
            r.weak.length ? h('div', { class: 'encart warn small' }, h('strong', { text: `Compétence sous ${rules.weak} %` }),
              h('span', { text: r.weak.map((id) => comps.find((k) => k.id === id).label + ' (' + r.byComp[id].pct + ' %)').join(', ') + '. Plan de progrès conseillé.' })) : null,
            r.alerts.length ? h('div', {}, r.alerts.map((a) => h('div', { class: 'encart ko small' },
              h('strong', { text: a.type === 'securite' ? 'Sécurité' : 'Honnêteté' }),
              h('span', { text: 'Situation : ' + a.question }), h('br'), h('span', { text: 'Réponse choisie comme meilleure : ' + a.answer })))) : null,
            c.tooFast ? h('div', { class: 'encart warn small' }, h('strong', { text: 'Test passé très vite' }),
              h('span', { text: `${Math.floor(c.durationSec / 60)} min ${c.durationSec % 60} s pour ${r.items.length} situations. À recouper en entretien.` })) : null
          ),
          svgBox(radarSVG(comps, comps.map((k) => r.byComp[k.id].pct), { threshold: rules.threshold }))
        ),
        h('div', { style: 'margin-top:20px' }, barres(comps, Object.fromEntries(comps.map((k) => [k.id, r.byComp[k.id].pct])), rules)),
        h('p', { class: 'small muted', text: `Ligne pointillée du radar : seuil de ${rules.threshold}. Le hasard donne environ 50 %. Passé le ${fmtDate(c.completedAt)}.` })
      ));

      blocs.push(synthesisCard(c));
      blocs.push(answersCard(c, comps));
      blocs.push(decisionCard(c));
    }

    if (c.history && c.history.length) blocs.push(historyCard(c, comps));

    blocs.push(h('div', { class: 'carte' },
      h('h2', { class: 'bloc-titre', text: 'Gestion du dossier' }),
      h('div', { class: 'actions', style: 'margin-top:0' },
        done ? h('button', { class: 'btn', type: 'button', onclick: async () => {
          if (!confirm('Autoriser un nouveau passage ? Le résultat actuel sera conservé dans l\'historique et un nouveau lien de test sera généré.')) return;
          await api(`/api/admin/candidates/${c.id}/reset`, { method: 'POST' });
          await refresh();
          detail(c.id);
        } }, 'Autoriser un nouveau passage') : null,
        h('button', { class: 'btn btn-danger', type: 'button', onclick: async () => {
          if (!confirm('Supprimer définitivement ce dossier ? Cette action est irréversible.')) return;
          await api('/api/admin/candidates/' + c.id, { method: 'DELETE' });
          await refresh();
          location.hash = '#/';
        } }, 'Supprimer le dossier')
      ),
      h('p', { class: 'small muted', text: 'Les dossiers sont supprimés automatiquement après la durée de conservation prévue (RGPD).' })
    ));

    frame(h('a', { class: 'retour', href: '#/' }, '← Retour aux candidats'), head, ...blocs);
  }

  function synthesisCard(c) {
    const s = c.synthesis;
    const wrap = h('div', { class: 'carte' });
    const msg = h('p', { class: 'small muted', role: 'status' });
    const render = (syn) => {
      wrap.replaceChildren(
        h('div', { class: 'barre-outils', style: 'margin:0 0 8px' },
          h('h2', { text: 'Synthèse pour l\'entretien' }),
          h('div', { class: 'espace' }),
          h('button', { class: 'btn btn-sm', type: 'button', onclick: async (e) => {
            e.target.disabled = true;
            msg.textContent = 'Rédaction en cours…';
            try {
              const r = await api(`/api/admin/candidates/${c.id}/synthesis`, { method: 'POST' });
              render(r.synthesis);
              msg.textContent = r.warning || '';
              wrap.append(msg);
            } catch (ex) {
              msg.textContent = ex.message;
              e.target.disabled = false;
            }
          } }, me.ai ? 'Rédiger avec Claude' : 'Régénérer')
        ),
        h('h3', { text: 'Points forts' }),
        h('ul', { class: 'liste-simple' }, syn.forces.map((f) => h('li', { text: f }))),
        h('h3', { text: 'Point de vigilance' }),
        h('p', { text: syn.vigilance }),
        h('h3', { text: 'Questions à creuser en entretien' }),
        h('ul', { class: 'liste-simple' }, syn.questions.map((q) => h('li', { text: q }))),
        h('p', { class: 'small muted', text: syn.source === 'claude' ? 'Rédigée par Claude à partir des scores uniquement (aucun nom transmis). À relire.' : 'Synthèse automatique à partir des scores.' })
      );
    };
    render(s);
    return wrap;
  }

  function answersCard(c, comps) {
    const label = Object.fromEntries(comps.map((k) => [k.id, k.short]));
    return h('div', { class: 'carte' },
      h('details', { class: 'reponses' },
        h('summary', { text: 'Voir les réponses détaillées' }),
        c.result.items.map((it) => h('div', { class: 'rep' },
          h('div', { class: 'q', text: `${label[it.competence]} · ${it.pts}/${it.max} · ${it.text}` }),
          h('div', { class: 'b', text: 'Meilleure : ' + it.best }),
          h('div', { class: 'w', text: 'Moins adaptée : ' + it.worst })
        ))
      )
    );
  }

  function historyCard(c, comps) {
    const label = Object.fromEntries(comps.map((k) => [k.id, k.short]));
    return h('div', { class: 'carte' },
      h('h2', { class: 'bloc-titre', text: `Historique des passages précédents (${c.history.length})` }),
      h('p', { class: 'muted', style: 'margin:0 0 14px', text: 'Ce candidat a déjà passé le test avant son passage actuel. Chaque passage est conservé.' }),
      ...c.history.slice().reverse().map((a) => {
        const v = VERDICT[a.result.verdict];
        const d = DECISION[a.decision];
        return h('details', { class: 'reponses', style: 'margin-bottom:10px' },
          h('summary', {}, `Passage ${a.attempt} · ${a.result.pct}/100 · ${v ? v[0] : a.result.verdict} · ${fmtDate(a.completedAt)}`),
          h('div', { style: 'padding:12px 4px 4px' },
            h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px' },
              pill(v ? v[0] : a.result.verdict, v ? v[1] : ''),
              d ? pill(...d) : h('span', { class: 'small muted', text: 'Aucune décision prise' })),
            a.decisionComment ? h('p', { class: 'small', text: 'Appréciation : ' + a.decisionComment }) : null,
            h('div', { class: 'rep' },
              a.result.items.map((it) => h('div', { class: 'rep' },
                h('div', { class: 'q', text: `${label[it.competence] || it.competence} · ${it.pts}/${it.max} · ${it.text}` }),
                h('div', { class: 'b', text: 'Meilleure : ' + it.best }),
                h('div', { class: 'w', text: 'Moins adaptée : ' + it.worst })
              ))
            )
          )
        );
      })
    );
  }

  function decisionCard(c) {
    const cur = c.decision;
    let val = cur;
    const err = h('p', { class: 'erreur', role: 'alert' });
    const ta = h('textarea', { id: 'cm', maxlength: '600', placeholder: 'Appréciation du responsable de formation (visible par l\'entreprise si le macaron est accordé)' });
    ta.value = c.decisionComment || '';
    const aide = h('p', { class: 'small muted' });
    const setAide = () => {
      aide.textContent = val === 'granted'
        ? (c.verdict === 'alerte' ? 'Une alerte est présente : justifiez la décision (10 caractères minimum).' : 'Cette appréciation figurera sur la fiche transmise aux entreprises.')
        : val === 'deferred' ? 'Indiquez le plan de progrès et la date du nouveau passage.'
        : val === 'refused' ? 'Indiquez le motif, en restant sur des comportements observés.' : '';
    };
    setAide();

    const choix = h('div', { class: 'decision-choix', role: 'radiogroup', 'aria-label': 'Décision' },
      [['granted', 'Accorder le macaron'], ['deferred', 'Différer'], ['refused', 'Refuser']].map(([v, t]) =>
        h('label', {}, h('input', { type: 'radio', name: 'dec', value: v, checked: v === cur ? true : null, onchange: () => { val = v; err.textContent = ''; setAide(); } }), t))
    );

    const save = h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
      if (!val) { err.textContent = 'Choisissez une décision'; return; }
      err.textContent = '';
      try {
        await api(`/api/admin/candidates/${c.id}/decision`, { method: 'PATCH', body: { decision: val, comment: ta.value } });
        await refresh();
        detail(c.id);
      } catch (ex) { err.textContent = ex.message; }
    } }, cur ? 'Mettre à jour la décision' : 'Enregistrer la décision');

    const extra = [];
    if (cur) {
      extra.push(h('button', { class: 'btn', type: 'button', onclick: async () => {
        await api(`/api/admin/candidates/${c.id}/decision`, { method: 'PATCH', body: { decision: null } });
        await refresh();
        detail(c.id);
      } }, 'Annuler la décision'));
    }

    const box = [
      h('h2', { class: 'bloc-titre', text: 'Décision du responsable de formation' }),
      h('p', { class: 'muted', text: 'Le score aide à décider, il ne décide pas. Le macaron est accordé après l\'entretien.' }),
      h('p', { class: 'small muted', text: 'Ce label reste interne et indicatif : il ne constitue pas une certification officielle et n\'engage pas la responsabilité de Les clés de l\'Atelier sur le comportement futur du candidat en entreprise.' }),
      cur ? h('p', { class: 'small muted', text: `Décision enregistrée par ${c.decisionBy} le ${fmtDate(c.decisionAt)}.` }) : null,
      choix, ta, aide, err,
      h('div', { class: 'actions' }, save, ...extra)
    ];

    if (cur === 'granted' && c.shareToken) {
      const url = ficheUrl(c.shareToken);
      const input = h('input', { type: 'text', readonly: true, value: url, 'aria-label': 'Lien de la fiche entreprise', onfocus: (e) => e.target.select() });
      const cp = h('button', { class: 'btn', type: 'button', onclick: () => copy(url, cp) }, 'Copier');
      box.push(h('div', { class: 'encart ok', style: 'margin-top:20px' },
        h('strong', { text: 'Fiche à transmettre aux entreprises' }),
        h('p', { class: 'small', text: 'Ce lien ouvre la fiche d\'une page (imprimable en PDF). Le label est valable 12 mois.' }),
        h('div', { class: 'lien-box' }, input, cp),
        h('div', { class: 'actions' }, h('a', { class: 'btn btn-sm', href: url, target: '_blank', rel: 'noopener' }, 'Ouvrir la fiche'))
      ));
    }
    return h('div', { class: 'carte' }, ...box);
  }

  // ---------- Routage ----------
  async function refresh() {
    list = await api('/api/admin/candidates');
  }

  async function route() {
    if (!me) return login();
    const m = location.hash.match(/^#\/c\/([a-f0-9]+)$/);
    if (m) return detail(m[1]);
    try { await refresh(); } catch (e) { if (e.status === 401) { me = null; return login(); } }
    dashboard();
  }

  async function boot() {
    meta = meta || (await api('/api/meta'));
    me = await api('/api/admin/me');
    route();
  }

  window.addEventListener('hashchange', route);
  api('/api/meta').then((m) => { meta = m; return api('/api/admin/me'); }).then((m) => { me = m; route(); }).catch(() => login());
})();
