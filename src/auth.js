const { createHash, randomBytes, scryptSync, timingSafeEqual } = require('node:crypto');
const store = require('./store');

const sessionMaxAgeSeconds = 60 * 60 * 24 * 7;
const loginWindowMilliseconds = 15 * 60 * 1000;
const loginAttemptLimit = 10;
const loginAttempts = new Map();
const fail = (status, message) => Object.assign(new Error(message), { status });
const dummyHash = '962cb2fd0153afb194c39886f22c4b2b:7be1803d91ee8ed843cf37be327346958d3ed4172967712986eb1a517278051a67dd4e3ac7adce0facea536a2c836bfc3bbd986d76c83c12e46d6961793d33f8';

function publicUser(user) {
  return { id: user.id, nombre: user.nombre, correo: user.correo, rol: user.rol };
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function passwordMatches(password, encodedHash) {
  const [salt, hash] = String(encodedHash || '').split(':');
  if (!salt || !/^[a-f\d]{128}$/i.test(hash || '')) return false;
  return timingSafeEqual(scryptSync(password, salt, 64), Buffer.from(hash, 'hex'));
}

function checkAttempt(key) {
  const now = Date.now();
  const attempts = (loginAttempts.get(key) || []).filter((time) => now - time < loginWindowMilliseconds);
  if (attempts.length >= loginAttemptLimit) {
    throw fail(429, 'Demasiados intentos. Espera 15 minutos antes de volver a probar.');
  }
  attempts.push(now);
  loginAttempts.set(key, attempts);
}

async function login(body, remoteAddress) {
  const correo = typeof body.correo === 'string' ? body.correo.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const key = `${remoteAddress}:${correo}`;
  checkAttempt(key);

  const result = await store.transact((state) => {
    const user = state.users.find((item) => item.id === 'admin');
    const hash = user?.passwordHash || dummyHash;
    if (!user || user.correo.toLowerCase() !== correo || !passwordMatches(password, hash)) {
      throw fail(401, 'Correo o contraseña incorrectos.');
    }
    const token = randomBytes(32).toString('base64url');
    state.sessions ||= [];
    state.sessions = state.sessions.filter((session) => session.expiresAt > Date.now());
    state.sessions.push({
      tokenHash: hashToken(token),
      userId: user.id,
      expiresAt: Date.now() + sessionMaxAgeSeconds * 1000
    });
    return { user: publicUser(user), token };
  });

  loginAttempts.delete(key);
  return result;
}

async function authenticate(token) {
  if (typeof token !== 'string' || !token) return null;
  const tokenHash = hashToken(token);
  return store.read((state) => {
    const session = (state.sessions || []).find((item) => item.tokenHash === tokenHash && item.expiresAt > Date.now());
    const user = session && state.users.find((item) => item.id === session.userId);
    return user ? publicUser(user) : null;
  });
}

async function logout(token) {
  if (typeof token !== 'string' || !token) return;
  const tokenHash = hashToken(token);
  await store.transact((state) => {
    state.sessions = (state.sessions || []).filter((session) => session.tokenHash !== tokenHash);
  });
}

module.exports = { authenticate, login, logout, sessionMaxAgeSeconds };
