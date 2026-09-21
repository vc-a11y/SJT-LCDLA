(function () {
  const { h, api, fmtDate, bandeau, radarSVG, macaronSVG, barres } = window.CDA;
  const app = document.getElementById('app');
  const share = location.pathname.split('/')[2] || '';

  const svgBox = (markup) => {
    const d = h('div');
    d.innerHTML = markup;
    return d;
  };

  function erreur(titre, texte) {
    app.replaceChildren(bandeau('Fiche candidat'), h('main', { class: 'narrow' }, h('h1', { text: titre }), h('p', { style: 'margin-top:16px', text: texte })));
  }

  async function init() {
    let meta, f;
    try {
      [meta, f] = await Promise.all([api('/api/meta'), api('/api/fiche/' + encodeURIComponent(share))]);
    } catch (e) {
      return erreur(e.status === 410 ? 'Ce label a expiré' : 'Fiche introuvable', e.status === 410
        ? 'Le label savoir-être est valable 12 mois. Contactez Les clés de l\'Atelier pour une mise à jour.'
        : 'Ce lien n\'est pas valide. Contactez Les clés de l\'Atelier au 09 50 00 60 80.');
    }
    document.title = `${f.firstName} ${f.lastName} · Fiche savoir-être`;
    const comps = meta.competences;
    const excellence = f.level === 'excellence';

    const forces = h('ul', {}, f.forces.map((t) => h('li', { text: t })));
    const appreciation = f.comment
      ? [h('p', { style: 'font-size:15px;margin-bottom:8px', text: f.comment }), h('p', { class: 'small muted', text: '— ' + f.trainer + ', responsable de formation' })]
      : [h('p', { class: 'small muted', text: 'Validé par ' + f.trainer + ', responsable de formation.' })];

    const corps = h('div', { class: 'corps' },
      h('div', { class: 'entete-fiche' },
        h('div', {},
          h('span', { class: 'pill' + (excellence ? ' or' : ''), text: excellence ? 'Macaron savoir-être · Excellence' : 'Macaron savoir-être' }),
          h('h1', { class: 'nom-candidat', style: 'margin-top:14px', text: `${f.firstName} ${f.lastName}` }),
          f.formation ? h('p', { style: 'font-size:18px;margin:6px 0 0', text: 'Formation : ' + f.formation }) : null,
          h('p', { class: 'small muted', style: 'margin-top:6px', text: `Label attribué le ${fmtDate(f.grantedAt)}, valable jusqu'au ${fmtDate(f.validUntil)}` })
        ),
        svgBox(macaronSVG(excellence ? 'excellence' : 'standard', 150))
      ),
      h('div', { class: 'deux-col', style: 'margin-top:26px' },
        svgBox(radarSVG(comps, comps.map((c) => f.byComp[c.id]), { max: 420 })),
        h('div', {},
          h('div', { class: 'gros-score', style: 'font-size:52px;margin-bottom:10px' }, String(f.pct), h('small', { text: ' / 100 · score global' })),
          barres(comps, f.byComp, meta.rules)
        )
      ),
      h('div', { class: 'trois' },
        h('div', {}, h('h3', { text: 'Points forts' }), forces),
        h('div', {}, h('h3', { text: 'Point de vigilance' }), h('p', { style: 'font-size:15px', text: f.vigilance })),
        h('div', {}, h('h3', { text: 'Appréciation' }), ...appreciation)
      ),
      h('div', { class: 'trois' },
        h('div', { style: 'grid-column:1/-1' },
          h('h3', { text: 'Comment ce label est attribué' }),
          h('p', { style: 'font-size:15px;margin:0', text: 'Le candidat passe un test de 24 mises en situation de chantier, tirées d\'une banque de situations, sur six compétences de savoir-être. Le score est calculé automatiquement selon un barème fixe. Un responsable de formation rencontre ensuite le candidat en entretien et décide seul d\'accorder le label. Toute réponse dangereuse sur la sécurité ou l\'honnêteté bloque l\'attribution sans justification.' })
        )
      )
    );

    const pied = h('div', { class: 'pied' },
      h('p', { style: 'margin:0 0 4px', text: 'Label interne Les clés de l\'Atelier, organisme de formation aux métiers du bâtiment second œuvre. Il ne constitue pas une certification officielle.' }),
      h('p', { style: 'margin:0', text: '43 chemin du Pras, 69350 La Mulatière · 09 50 00 60 80 · contact@lesclesdelatelier.fr' })
    );

    app.replaceChildren(
      h('div', { class: 'outils-fiche' }, h('button', { class: 'btn btn-primary', type: 'button', onclick: () => window.print() }, 'Imprimer ou enregistrer en PDF')),
      h('article', { class: 'a4' },
        h('div', { class: 'bandeau', style: 'min-height:80px' },
          h('img', { src: '/img/logo-256.png', alt: 'Les clés de l\'Atelier', width: 80, height: 80, style: 'width:80px;height:80px' }),
          h('div', { class: 'titre', text: 'Fiche candidat · Savoir-être' })),
        h('div', { class: 'filet' }),
        corps,
        pied
      )
    );
  }

  init();
})();
