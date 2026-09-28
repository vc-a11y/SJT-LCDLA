const { COMPETENCES, RULES, compById } = require('./scoring');

function autoSynthesis(result) {
  const list = COMPETENCES.map((c) => ({ c, pct: result.byComp[c.id].pct })).sort((a, b) => b.pct - a.pct);

  const strongOnes = list.filter((x) => x.pct >= RULES.strong).slice(0, 3);
  const forces = (strongOnes.length ? strongOnes : list.slice(0, 2)).map(
    (x) => `${x.c.label} : ${x.pct} % de réponses adaptées`
  );

  const lowest = list[list.length - 1];
  let vigilance;
  if (result.alerts.length) {
    const types = [...new Set(result.alerts.map((a) => (a.type === 'securite' ? 'la sécurité' : 'l\'honnêteté')))];
    vigilance = `Réponse jugée inadaptée sur ${types.join(' et ')} : à explorer en entretien avant toute décision.`;
  } else if (lowest.pct < RULES.weak) {
    vigilance = `${lowest.c.label} : ${lowest.pct} %, point à consolider pendant la formation.`;
  } else {
    vigilance = `Aucun point faible marqué. Compétence la moins forte : ${lowest.c.label} (${lowest.pct} %).`;
  }

  const focus = result.alerts.length
    ? [...new Set(result.alerts.map((a) => a.competence))]
    : list.filter((x) => x.pct < RULES.strong).slice(-2).map((x) => x.c.id).reverse();
  const questions = [];
  for (const id of focus) {
    const c = compById.get(id);
    if (c) questions.push(c.followups[0]);
  }
  if (!questions.length) questions.push(COMPETENCES[0].followups[0]);

  return { forces, vigilance, questions: questions.slice(0, 4), source: 'auto' };
}

async function claudeSynthesis(result) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

  const payload = {
    score_global_sur_100: result.pct,
    seuil: RULES.threshold,
    competences: COMPETENCES.map((c) => ({ nom: c.label, score_sur_100: result.byComp[c.id].pct })),
    alertes: result.alerts.map((a) => ({
      type: a.type === 'securite' ? 'sécurité' : 'honnêteté',
      situation: a.question,
      reponse_choisie: a.answer,
    })),
  };

  const system =
    "Tu aides les responsables de formation d'un organisme de formation aux métiers du bâtiment second œuvre. " +
    'À partir des résultats chiffrés d\'un test de jugement situationnel sur le savoir-être, tu rédiges une synthèse courte, factuelle et bienveillante. ' +
    'Tu ne parles que de comportements professionnels, jamais de la personne, de son origine, de son âge ni de son genre. ' +
    'Tu ne prends aucune décision : le responsable de formation décide. ' +
    'Réponds uniquement par un objet JSON valide, sans texte autour, de la forme ' +
    '{"forces": [2 à 3 phrases courtes], "vigilance": "une phrase", "questions": [3 à 4 questions d\'entretien comportemental de type STAR, en français simple]}.';

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 800,
      system,
      messages: [{ role: 'user', content: JSON.stringify(payload) }],
    }),
  });
  if (!res.ok) throw new Error(`API Claude : ${res.status}`);
  const data = await res.json();
  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  const clean = text.replace(/```json|```/g, '').trim();
  const parsed = JSON.parse(clean);
  const strArr = (a, n) => (Array.isArray(a) ? a.filter((s) => typeof s === 'string').slice(0, n) : []);
  const out = {
    forces: strArr(parsed.forces, 3),
    vigilance: typeof parsed.vigilance === 'string' ? parsed.vigilance : '',
    questions: strArr(parsed.questions, 4),
    source: 'claude',
  };
  if (!out.forces.length || !out.vigilance || !out.questions.length) throw new Error('Réponse incomplète');
  return out;
}

module.exports = { autoSynthesis, claudeSynthesis };
