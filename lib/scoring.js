const crypto = require('crypto');
const bank = require('../data/questions.json');

const COMPETENCES = bank.competences;
const PER_COMPETENCE = 4;
const MAX_PER_QUESTION = 6;

const RULES = {
  threshold: 70,
  excellence: 85,
  weak: 60,
  strong: 85,
  minSeconds: 240,
  validityMonths: 12,
  alertMin: Math.max(1, Number(process.env.ALERT_MIN || 1)),
  questionSeconds: Math.max(15, Number(process.env.QUESTION_SECONDS || 60)),
  reminderDays: Math.max(1, Number(process.env.REMINDER_DAYS || 2)),
};

const byId = new Map(bank.questions.map((q) => [q.id, q]));
const compById = new Map(COMPETENCES.map((c) => [c.id, c]));

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function drawTest() {
  const picked = [];
  for (const c of COMPETENCES) {
    const pool = bank.questions.filter((q) => q.c === c.id);
    picked.push(...shuffle(pool).slice(0, PER_COMPETENCE));
  }
  return shuffle(picked).map((q) => ({
    id: q.id,
    order: shuffle(q.o.map((_, i) => i)),
  }));
}

function publicQuestions(draw) {
  return draw.map(({ id, order }) => {
    const q = byId.get(id);
    return {
      id,
      text: q.t,
      textReformule: q.ts || q.t,
      options: order.map((i) => ({ i, text: q.o[i].t })),
    };
  });
}

function validateAnswers(draw, answers) {
  if (!Array.isArray(answers) || answers.length !== draw.length) {
    throw new Error('Réponses incomplètes');
  }
  const map = new Map(answers.map((a) => [a && a.id, a]));
  return draw.map((d) => {
    const a = map.get(d.id);
    if (!a) throw new Error('Réponses incomplètes');
    const { best, worst } = a;
    const n = byId.get(d.id).o.length;
    const ok = (v) => Number.isInteger(v) && v >= 0 && v < n;
    if (!ok(best) || !ok(worst) || best === worst) throw new Error('Réponse invalide');
    return { id: d.id, best, worst };
  });
}

function scoreTest(draw, answers) {
  const clean = validateAnswers(draw, answers);
  const byComp = {};
  for (const c of COMPETENCES) byComp[c.id] = { pts: 0, max: 0, pct: 0 };
  const items = [];
  const alerts = [];

  for (const a of clean) {
    const q = byId.get(a.id);
    const b = q.o[a.best];
    const w = q.o[a.worst];
    const pts = b.q + (3 - w.q);
    byComp[q.c].pts += pts;
    byComp[q.c].max += MAX_PER_QUESTION;
    items.push({
      id: q.id,
      competence: q.c,
      text: q.t,
      best: b.t,
      worst: w.t,
      bestQ: b.q,
      worstQ: w.q,
      pts,
      max: MAX_PER_QUESTION,
      danger: b.d === 1,
    });
    if (b.d === 1) {
      alerts.push({
        type: q.c === 'securite' ? 'securite' : 'honnetete',
        competence: q.c,
        question: q.t,
        answer: b.t,
      });
    }
  }

  let total = 0;
  let max = 0;
  for (const c of COMPETENCES) {
    const r = byComp[c.id];
    r.pct = r.max ? Math.round((r.pts / r.max) * 100) : 0;
    total += r.pts;
    max += r.max;
  }
  const pct = max ? Math.round((total / max) * 100) : 0;

  const weak = COMPETENCES.filter((c) => byComp[c.id].pct < RULES.weak).map((c) => c.id);
  const strong = COMPETENCES.filter((c) => byComp[c.id].pct >= RULES.strong).map((c) => c.id);

  let verdict = 'non_atteint';
  if (alerts.length >= RULES.alertMin) verdict = 'alerte';
  else if (pct >= RULES.excellence) verdict = 'excellence';
  else if (pct >= RULES.threshold) verdict = 'atteint';

  return { byComp, total, max, pct, alerts, weak, strong, verdict, items };
}

function compLabel(id) {
  const c = compById.get(id);
  return c ? c.label : id;
}

module.exports = {
  COMPETENCES,
  RULES,
  drawTest,
  publicQuestions,
  scoreTest,
  compLabel,
  compById,
};
