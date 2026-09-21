const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.PORT = '0';
process.env.ADMIN_PASSWORD = 'secret-test';
process.env.SESSION_SECRET = 'x'.repeat(40);
process.env.DATA_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cda-')), 'c.json');
delete process.env.DATABASE_URL;
delete process.env.ANTHROPIC_API_KEY;

const bank = require('../data/questions.json');
const { main } = require('../server');

let server;
let base;
let cookie;

const call = async (method, url, body, withCookie = true) => {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(withCookie && cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* vide */ }
  return { status: res.status, json, res };
};

const byId = new Map(bank.questions.map((q) => [q.id, q]));
const pick = (q, strategy) => {
  const idx = q.o.map((o, i) => ({ ...o, i }));
  const sorted = idx.slice().sort((a, b) => b.q - a.q);
  if (strategy === 'ideal') return { best: sorted[0].i, worst: sorted[sorted.length - 1].i };
  if (strategy === 'danger') {
    const d = idx.find((o) => o.d === 1);
    const other = idx.find((o) => o !== d && o.i !== (d ? d.i : -1));
    if (d) return { best: d.i, worst: sorted[0].i };
    return { best: sorted[0].i, worst: sorted[sorted.length - 1].i };
  }
  const safe = idx.filter((o) => o.d !== 1).sort((a, b) => a.q - b.q);
  return { best: safe[0].i, worst: sorted[0].i };
};

async function passTest(token, strategy) {
  const start = await call('POST', `/api/test/${token}/start`, { consent: true }, false);
  assert.equal(start.status, 200);
  const answers = start.json.questions.map((q) => ({ id: q.id, ...pick(byId.get(q.id), strategy) }));
  return call('POST', `/api/test/${token}/submit`, { answers }, false);
}

test.before(async () => {
  server = await main();
  base = 'http://127.0.0.1:' + server.address().port;
});
test.after(() => server.close());

test('les questions sont bien formées', () => {
  assert.equal(bank.competences.length, 6);
  for (const c of bank.competences) {
    assert.equal(bank.questions.filter((q) => q.c === c.id).length, 6, c.id);
  }
  for (const q of bank.questions) {
    assert.equal(q.o.length, 4, q.id);
    assert.ok(q.o.some((o) => o.q === 3), q.id + ' sans meilleure réponse');
    assert.ok(q.o.some((o) => o.q === 0), q.id + ' sans pire réponse');
  }
});

test('les routes responsables exigent une connexion', async () => {
  assert.equal((await call('GET', '/api/admin/candidates', null, false)).status, 401);
  assert.equal((await call('POST', '/api/admin/login', { name: 'Marie', password: 'faux' }, false)).status, 401);
});

test('parcours complet : macaron accordé', async () => {
  const login = await call('POST', '/api/admin/login', { name: 'Marie', password: 'secret-test' }, false);
  assert.equal(login.status, 200);
  cookie = login.res.headers.get('set-cookie').split(';')[0];

  const created = await call('POST', '/api/admin/candidates', { firstName: 'Karim', lastName: 'Benali', formation: 'Plaquiste' });
  assert.equal(created.status, 201);
  const token = created.json.token;

  const info = await call('GET', `/api/test/${token}`, null, false);
  assert.equal(info.json.firstName, 'Karim');

  assert.equal((await call('POST', `/api/test/${token}/start`, {}, false)).status, 400);

  const start = await call('POST', `/api/test/${token}/start`, { consent: true }, false);
  assert.equal(start.json.questions.length, 24);
  assert.ok(!JSON.stringify(start.json).includes('"q"'), 'le barème ne doit pas fuiter');
  const perComp = {};
  for (const q of start.json.questions) perComp[byId.get(q.id).c] = (perComp[byId.get(q.id).c] || 0) + 1;
  assert.deepEqual(Object.values(perComp), [4, 4, 4, 4, 4, 4]);

  const again = await call('POST', `/api/test/${token}/start`, { consent: true }, false);
  assert.deepEqual(again.json.questions.map((q) => q.id), start.json.questions.map((q) => q.id), 'reprise à l\'identique');

  const bad = await call('POST', `/api/test/${token}/submit`, { answers: [] }, false);
  assert.equal(bad.status, 400);

  const done = await passTest(token, 'ideal');
  assert.equal(done.status, 200);
  assert.equal((await call('POST', `/api/test/${token}/submit`, { answers: [] }, false)).status, 409);

  const detail = await call('GET', `/api/admin/candidates/${created.json.id}`);
  assert.equal(detail.json.result.pct, 100);
  assert.equal(detail.json.result.verdict, 'excellence');
  assert.equal(detail.json.tooFast, true);
  assert.ok(detail.json.synthesis.forces.length > 0);

  const dec = await call('PATCH', `/api/admin/candidates/${created.json.id}/decision`, { decision: 'granted', comment: 'Très bon entretien.' });
  assert.equal(dec.status, 200);
  assert.ok(dec.json.shareToken);

  const fiche = await call('GET', `/api/fiche/${dec.json.shareToken}`, null, false);
  assert.equal(fiche.status, 200);
  assert.equal(fiche.json.level, 'excellence');
  assert.equal(fiche.json.lastName, 'Benali');
  assert.ok(!('items' in fiche.json) && !('email' in fiche.json));

  assert.equal((await call('GET', '/api/fiche/inconnu', null, false)).status, 404);
});

test('une réponse dangereuse déclenche une alerte et bloque sans justification', async () => {
  const c = (await call('POST', '/api/admin/candidates', { firstName: 'Léa', lastName: 'Durand' })).json;
  assert.equal((await passTest(c.token, 'danger')).status, 200);
  const d = (await call('GET', `/api/admin/candidates/${c.id}`)).json;
  assert.equal(d.result.verdict, 'alerte');
  assert.ok(d.result.alerts.length > 0);

  const noComment = await call('PATCH', `/api/admin/candidates/${c.id}/decision`, { decision: 'granted', comment: '' });
  assert.equal(noComment.status, 400);
  const ok = await call('PATCH', `/api/admin/candidates/${c.id}/decision`, { decision: 'granted', comment: 'Erreur de compréhension levée en entretien.' });
  assert.equal(ok.status, 200);
});

test('seuil non atteint, différé, nouveau passage et suppression', async () => {
  const c = (await call('POST', '/api/admin/candidates', { firstName: 'Sam', lastName: 'Petit' })).json;
  assert.equal((await passTest(c.token, 'poor')).status, 200);
  const d = (await call('GET', `/api/admin/candidates/${c.id}`)).json;
  assert.ok(d.result.pct < 70, 'score ' + d.result.pct);

  assert.equal((await call('PATCH', `/api/admin/candidates/${c.id}/decision`, { decision: 'refused', comment: '' })).status, 400);
  assert.equal((await call('PATCH', `/api/admin/candidates/${c.id}/decision`, { decision: 'deferred', comment: 'Plan de progrès 4 semaines' })).status, 200);

  const reset = await call('POST', `/api/admin/candidates/${c.id}/reset`);
  assert.equal(reset.json.status, 'invited');
  assert.notEqual(reset.json.token, c.token);
  assert.equal((await call('GET', `/api/test/${c.token}`, null, false)).status, 404, 'l\'ancien lien est invalidé');

  assert.equal((await call('DELETE', `/api/admin/candidates/${c.id}`)).status, 200);
  assert.equal((await call('GET', `/api/admin/candidates/${c.id}`)).status, 404);
});

test('export CSV', async () => {
  const r = await call('GET', '/api/admin/export.csv');
  assert.equal(r.status, 200);
});
