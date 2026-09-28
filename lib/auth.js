const crypto = require('crypto');

const COOKIE = 'cda_session';
const SESSION_HOURS = 12;

const SECRET =
  process.env.SESSION_SECRET ||
  (() => {
    console.warn('[auth] SESSION_SECRET absent : secret aléatoire, les sessions seront perdues au redémarrage.');
    return crypto.randomBytes(32).toString('hex');
  })();

function configuredUsers() {
  const raw = process.env.ADMIN_USERS;
  if (raw) {
    return raw
      .split(',')
      .map((s) => {
        const i = s.indexOf(':');
        return { name: s.slice(0, i).trim(), pwd: s.slice(i + 1) };
      })
      .filter((u) => u.name && u.pwd);
  }
  return [];
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function checkLogin(name, password) {
  const users = configuredUsers();
  const cleanName = String(name || '').trim().slice(0, 60);
  if (users.length) {
    const u = users.find((x) => x.name.toLowerCase() === cleanName.toLowerCase());
    if (u && safeEqual(u.pwd, password)) return u.name;
    return null;
  }
  const shared = process.env.ADMIN_PASSWORD;
  if (shared && cleanName && safeEqual(shared, password)) return cleanName;
  return null;
}

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${mac}`;
}

function verify(token) {
  if (!token || !token.includes('.')) return null;
  const [body, mac] = token.split('.');
  const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  if (mac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!p.e || p.e < Date.now()) return null;
    return p;
  } catch {
    return null;
  }
}

function parseCookies(header) {
  const out = {};
  (header || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function setSession(res, name) {
  const token = sign({ n: name, e: Date.now() + SESSION_HOURS * 3600 * 1000 });
  const parts = [
    `${COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_HOURS * 3600}`,
  ];
  if (process.env.NODE_ENV === 'production') parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSession(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function requireAdmin(req, res, next) {
  const p = verify(parseCookies(req.headers.cookie)[COOKIE]);
  if (!p) return res.status(401).json({ error: 'Connexion requise' });
  req.admin = { name: p.n };
  next();
}

const attempts = new Map();
function loginLimiter(req, res, next) {
  const ip = req.ip || 'x';
  const now = Date.now();
  const rec = attempts.get(ip);
  if (!rec || rec.reset < now) attempts.set(ip, { count: 0, reset: now + 15 * 60 * 1000 });
  const cur = attempts.get(ip);
  if (cur.count >= 8) {
    return res.status(429).json({ error: 'Trop de tentatives. Réessayez dans quelques minutes.' });
  }
  res.on('finish', () => {
    if (res.statusCode === 401) cur.count++;
    else if (res.statusCode === 200) attempts.delete(ip);
  });
  next();
}

module.exports = { checkLogin, setSession, clearSession, requireAdmin, loginLimiter, configuredUsers };
