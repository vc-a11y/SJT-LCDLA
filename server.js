const path = require('path');
const crypto = require('crypto');
const express = require('express');

const { createStore } = require('./lib/db');
const auth = require('./lib/auth');
const { COMPETENCES, RULES, drawTest, publicQuestions, scoreTest } = require('./lib/scoring');
const { autoSynthesis, claudeSynthesis } = require('./lib/synthesis');

const RETENTION_MONTHS = Number(process.env.RETENTION_MONTHS || 24);
const DECISIONS = ['granted', 'deferred', 'refused'];

const newId = () => crypto.randomBytes(8).toString('hex');
const newToken = () => crypto.randomBytes(24).toString('base64url');
const clean = (v, n = 80) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, n);
const addMonths = (iso, m) => {
  const d = new Date(iso);
  d.setMonth(d.getMonth() + m);
  return d.toISOString();
};

function adminView(c, full = false) {
  const out = {
    id: c.id,
    token: c.token,
    firstName: c.firstName,
    lastName: c.lastName,
    email: c.email,
    formation: c.formation,
    trainer: c.trainer,
    status: c.status,
    attempts: c.attempts || 1,
    createdAt: c.createdAt,
    completedAt: c.completedAt || null,
    durationSec: c.durationSec || null,
    tooFast: !!c.tooFast,
    decision: c.decision || null,
    decisionAt: c.decisionAt || null,
    decisionBy: c.decisionBy || null,
    decisionComment: c.decisionComment || '',
    shareToken: c.decision === 'granted' ? c.shareToken : null,
    pct: c.result ? c.result.pct : null,
    verdict: c.result ? c.result.verdict : null,
    alertCount: c.result ? c.result.alerts.length : 0,
    lastReminderAt: c.lastReminderAt || null,
    reminderCount: c.reminderCount || 0,
    historyCount: c.history ? c.history.length : 0,
  };
  if (full) {
    out.result = c.result || null;
    out.synthesis = c.synthesis || null;
    out.consentAt = c.consentAt || null;
    out.history = c.history || [];
  }
  return out;
}

async function main() {
  const store = await createStore();
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
        "font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    if (process.env.NODE_ENV === 'production') {
      res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
    }
    next();
  });
  app.use(express.json({ limit: '100kb' }));

  app.get('/healthz', async (req, res) => {
    try {
      await store.ping();
      res.json({ ok: true, store: store.kind });
    } catch {
      res.status(500).json({ ok: false });
    }
  });

  app.get('/api/meta', (req, res) => {
    res.json({
      competences: COMPETENCES.map(({ id, label, short }) => ({ id, label, short })),
      rules: RULES,
    });
  });

  const noStore = (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  };

  // ---------- Candidat ----------
  app.get('/api/test/:token', noStore, async (req, res) => {
    const c = await store.byToken(req.params.token);
    if (!c) return res.status(404).json({ error: 'Lien invalide' });
    res.json({
      firstName: c.firstName,
      status: c.status,
      questionCount: c.draw ? c.draw.length : COMPETENCES.length * 4,
    });
  });

  app.post('/api/test/:token/start', noStore, async (req, res) => {
    const c = await store.byToken(req.params.token);
    if (!c) return res.status(404).json({ error: 'Lien invalide' });
    if (c.status === 'completed') return res.status(409).json({ error: 'Ce test a déjà été passé' });
    if (req.body.consent !== true) return res.status(400).json({ error: 'Le consentement est nécessaire pour commencer' });
    if (!c.draw) c.draw = drawTest();
    const now = new Date().toISOString();
    if (!c.consentAt) c.consentAt = now;
    if (!c.startedAt) c.startedAt = now;
    c.status = 'started';
    await store.save(c);
    res.json({ firstName: c.firstName, questions: publicQuestions(c.draw) });
  });

  app.post('/api/test/:token/submit', noStore, async (req, res) => {
    const c = await store.byToken(req.params.token);
    if (!c) return res.status(404).json({ error: 'Lien invalide' });
    if (c.status === 'completed') return res.status(409).json({ error: 'Ce test a déjà été passé' });
    if (c.status !== 'started' || !c.draw) return res.status(400).json({ error: 'Le test n\'a pas été commencé' });
    let result;
    try {
      result = scoreTest(c.draw, req.body.answers);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    const now = new Date();
    c.answers = req.body.answers;
    c.result = result;
    c.synthesis = autoSynthesis(result);
    c.completedAt = now.toISOString();
    c.durationSec = Math.max(0, Math.round((now - new Date(c.startedAt)) / 1000));
    c.tooFast = c.durationSec < RULES.minSeconds;
    c.status = 'completed';
    await store.save(c);
    res.json({ ok: true });
  });

  // ---------- Fiche entreprise (lien partagé, seulement si macaron accordé) ----------
  app.get('/api/fiche/:share', noStore, async (req, res) => {
    const c = await store.byShare(req.params.share);
    if (!c || c.decision !== 'granted' || !c.result) return res.status(404).json({ error: 'Fiche introuvable' });
    const validUntil = addMonths(c.decisionAt, RULES.validityMonths);
    if (new Date(validUntil) < new Date()) return res.status(410).json({ error: 'Ce label a expiré' });
    res.json({
      firstName: c.firstName,
      lastName: c.lastName,
      formation: c.formation,
      level: c.result.verdict === 'excellence' ? 'excellence' : 'standard',
      pct: c.result.pct,
      byComp: Object.fromEntries(Object.entries(c.result.byComp).map(([k, v]) => [k, v.pct])),
      forces: c.synthesis ? c.synthesis.forces : [],
      vigilance: c.synthesis ? c.synthesis.vigilance : '',
      comment: c.decisionComment || '',
      trainer: c.decisionBy || c.trainer,
      grantedAt: c.decisionAt,
      validUntil,
    });
  });

  // ---------- Responsables de formation ----------
  app.post('/api/admin/login', auth.loginLimiter, (req, res) => {
    const name = auth.checkLogin(req.body.name, req.body.password);
    if (!name) return res.status(401).json({ error: 'Identifiants incorrects' });
    auth.setSession(res, name);
    res.json({ name });
  });
  app.post('/api/admin/logout', (req, res) => {
    auth.clearSession(res);
    res.json({ ok: true });
  });
  app.get('/api/admin/me', auth.requireAdmin, noStore, (req, res) => {
    res.json({ name: req.admin.name, multiUser: auth.configuredUsers().length > 0, ai: !!process.env.ANTHROPIC_API_KEY });
  });

  const admin = express.Router();
  admin.use(auth.requireAdmin, noStore);

  admin.get('/candidates', async (req, res) => {
    res.json((await store.list()).map((c) => adminView(c)));
  });

  admin.post('/candidates', async (req, res) => {
    const firstName = clean(req.body.firstName, 50);
    const lastName = clean(req.body.lastName, 50);
    const email = clean(req.body.email, 120);
    if (!firstName || !lastName) return res.status(400).json({ error: 'Prénom et nom sont obligatoires' });
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Adresse e-mail invalide' });
    const doc = {
      id: newId(),
      token: newToken(),
      shareToken: newToken(),
      createdAt: new Date().toISOString(),
      firstName,
      lastName,
      email,
      formation: clean(req.body.formation, 80),
      trainer: req.admin.name,
      status: 'invited',
      attempts: 1,
    };
    await store.insert(doc);
    res.status(201).json(adminView(doc, true));
  });

  admin.get('/candidates/:id', async (req, res) => {
    const c = await store.get(req.params.id);
    if (!c) return res.status(404).json({ error: 'Candidat introuvable' });
    res.json(adminView(c, true));
  });

  admin.patch('/candidates/:id/decision', async (req, res) => {
    const c = await store.get(req.params.id);
    if (!c) return res.status(404).json({ error: 'Candidat introuvable' });
    if (c.status !== 'completed') return res.status(400).json({ error: 'Le test n\'est pas terminé' });
    const decision = req.body.decision;
    const comment = clean(req.body.comment, 600);
    if (decision !== null && !DECISIONS.includes(decision)) return res.status(400).json({ error: 'Décision invalide' });
    if (decision === 'granted' && c.result.verdict === 'alerte' && comment.length < 10) {
      return res.status(400).json({ error: 'Une alerte est présente : justifiez la décision dans le commentaire' });
    }
    if ((decision === 'deferred' || decision === 'refused') && comment.length < 3) {
      return res.status(400).json({ error: 'Ajoutez un commentaire pour motiver la décision' });
    }
    c.decision = decision;
    c.decisionComment = decision ? comment : '';
    c.decisionAt = decision ? new Date().toISOString() : null;
    c.decisionBy = decision ? req.admin.name : null;
    await store.save(c);
    res.json(adminView(c, true));
  });

  admin.post('/candidates/:id/synthesis', async (req, res) => {
    const c = await store.get(req.params.id);
    if (!c || !c.result) return res.status(404).json({ error: 'Résultat introuvable' });
    let warning = null;
    let synth = null;
    try {
      synth = await claudeSynthesis(c.result);
      if (!synth) warning = 'Clé API Claude non configurée : synthèse automatique standard utilisée.';
    } catch (e) {
      console.error('[synthesis]', e.message);
      warning = 'La rédaction par Claude a échoué : synthèse automatique standard utilisée.';
    }
    c.synthesis = synth || autoSynthesis(c.result);
    await store.save(c);
    res.json({ synthesis: c.synthesis, warning });
  });

  admin.post('/candidates/:id/reset', async (req, res) => {
    const c = await store.get(req.params.id);
    if (!c) return res.status(404).json({ error: 'Candidat introuvable' });
    if (c.status === 'completed' && c.result) {
      c.history = c.history || [];
      c.history.push({
        attempt: c.attempts || 1,
        completedAt: c.completedAt,
        durationSec: c.durationSec,
        tooFast: !!c.tooFast,
        result: c.result,
        synthesis: c.synthesis || null,
        decision: c.decision || null,
        decisionComment: c.decisionComment || '',
        decisionAt: c.decisionAt || null,
        decisionBy: c.decisionBy || null,
      });
    }
    for (const k of ['draw', 'answers', 'result', 'synthesis', 'consentAt', 'startedAt', 'completedAt', 'durationSec', 'tooFast', 'decisionAt', 'decisionBy']) {
      delete c[k];
    }
    c.decision = null;
    c.decisionComment = '';
    c.status = 'invited';
    c.attempts = (c.attempts || 1) + 1;
    c.token = newToken();
    c.shareToken = newToken();
    c.lastReminderAt = null;
    c.reminderCount = 0;
    await store.save(c);
    res.json(adminView(c, true));
  });

  admin.post('/candidates/:id/remind', async (req, res) => {
    const c = await store.get(req.params.id);
    if (!c) return res.status(404).json({ error: 'Candidat introuvable' });
    if (c.status === 'completed') return res.status(400).json({ error: 'Ce candidat a déjà terminé le test' });
    c.lastReminderAt = new Date().toISOString();
    c.reminderCount = (c.reminderCount || 0) + 1;
    await store.save(c);
    res.json(adminView(c, true));
  });

  admin.delete('/candidates/:id', async (req, res) => {
    await store.remove(req.params.id);
    res.json({ ok: true });
  });

  admin.get('/export.csv', async (req, res) => {
    const rows = await store.list();
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['Prénom', 'Nom', 'Formation', 'Statut', 'Score', 'Verdict', 'Alertes', 'Décision', 'Date test', 'Responsable', 'Passages précédents', 'Relances envoyées'];
    const lines = rows.map((c) =>
      [
        c.firstName,
        c.lastName,
        c.formation,
        c.status,
        c.result ? c.result.pct : '',
        c.result ? c.result.verdict : '',
        c.result ? c.result.alerts.length : '',
        c.decision || '',
        c.completedAt ? c.completedAt.slice(0, 10) : '',
        c.decisionBy || c.trainer,
        c.history ? c.history.length : 0,
        c.reminderCount || 0,
      ]
        .map(esc)
        .join(',')
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="candidats-savoir-etre.csv"');
    res.send('\uFEFF' + [head.map(esc).join(','), ...lines].join('\r\n'));
  });

  app.use('/api/admin', admin);

  // ---------- Pages ----------
  const pub = path.join(__dirname, 'public');
  const page = (name) => (req, res) => res.sendFile(path.join(pub, name));
  app.get('/', page('index.html'));
  app.get('/admin', page('admin.html'));
  app.get('/t/:token', page('test.html'));
  app.get('/f/:share', page('fiche.html'));
  app.use(express.static(pub, { maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0 }));

  app.use('/api', (req, res) => res.status(404).json({ error: 'Introuvable' }));
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  });

  async function purge() {
    try {
      const limit = new Date();
      limit.setMonth(limit.getMonth() - RETENTION_MONTHS);
      const n = await store.purgeBefore(limit.toISOString());
      if (n) console.log(`[rgpd] ${n} dossier(s) supprimé(s) (conservation ${RETENTION_MONTHS} mois)`);
    } catch (e) {
      console.error('[rgpd]', e.message);
    }
  }
  await purge();
  setInterval(purge, 24 * 3600 * 1000).unref();

  const port = process.env.PORT || 3000;
  return new Promise((resolve) => {
    const server = app.listen(port, () => {
      console.log(`Les Clés de l'Atelier · test savoir-être sur le port ${port} (stockage : ${store.kind})`);
      resolve(server);
    });
  });
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { main };
