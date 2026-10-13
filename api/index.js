const fs = require('node:fs');
const path = require('node:path');
const auth = require('../src/auth');
const services = require('../src/services');

const publicDirectory = path.join(__dirname, '..');
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

function send(response, status, body, contentType = 'application/json; charset=utf-8') {
  response.statusCode = status;
  response.setHeader('Content-Type', contentType);
  response.setHeader('Cache-Control', 'no-store');
  response.end(contentType.startsWith('application/json') ? JSON.stringify(body) : body);
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1_000_000) throw Object.assign(new Error('La solicitud es demasiado grande.'), { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw Object.assign(new Error('El cuerpo debe ser un objeto JSON.'), { status: 400 });
    }
    return body;
  } catch {
    throw Object.assign(new Error('El cuerpo debe ser JSON válido.'), { status: 400 });
  }
}

function serveStatic(urlPath, response) {
  const requestedPath = urlPath === '/' ? '/index.html' : decodeURIComponent(urlPath);
  const filePath = path.resolve(publicDirectory, `.${requestedPath}`);
  if (!filePath.startsWith(`${publicDirectory}${path.sep}`)) return send(response, 403, { error: 'Acceso denegado.' });
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return send(response, 404, { error: 'No encontrado.' });
  send(response, 200, fs.readFileSync(filePath), contentTypes[path.extname(filePath)] || 'application/octet-stream');
}

function getSessionToken(request) {
  const sessionCookie = (request.headers.cookie || '')
    .split(';')
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith('aurea_session='));
  return sessionCookie ? sessionCookie.slice('aurea_session='.length) : '';
}

function setSessionCookie(request, response, token) {
  const forwardedProtocol = request.headers['x-forwarded-proto']?.split(',')[0].trim().toLowerCase();
  const secure = process.env.COOKIE_SECURE === 'true'
    || (process.env.COOKIE_SECURE !== 'false' && (request.headers['x-forwarded-proto'] === 'https' || forwardedProtocol === 'https'));
  response.setHeader('Set-Cookie', `aurea_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${auth.sessionMaxAgeSeconds}${secure ? '; Secure' : ''}`);
}

function clearSessionCookie(request, response) {
  const forwardedProtocol = request.headers['x-forwarded-proto']?.split(',')[0].trim().toLowerCase();
  const secure = process.env.COOKIE_SECURE === 'true'
    || (process.env.COOKIE_SECURE !== 'false' && (request.headers['x-forwarded-proto'] === 'https' || forwardedProtocol === 'https'));
  response.setHeader('Set-Cookie', `aurea_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure ? '; Secure' : ''}`);
}

async function handleApi(request, response, url) {
  const method = request.method;
  const pathname = url.pathname;

  if (pathname === '/api/auth/session' && method === 'GET') {
    return send(response, 200, { user: await auth.authenticate(getSessionToken(request)) });
  }
  if (pathname === '/api/auth/login' && method === 'POST') {
    const result = await auth.login(await readBody(request), request.headers['x-forwarded-for'] || request.socket?.remoteAddress || 'unknown');
    setSessionCookie(request, response, result.token);
    return send(response, 200, { user: result.user });
  }
  if (pathname === '/api/auth/logout' && method === 'POST') {
    await auth.logout(getSessionToken(request));
    clearSessionCookie(request, response);
    return send(response, 200, { success: true });
  }

  const actor = await auth.authenticate(getSessionToken(request));
  if (!actor) throw Object.assign(new Error('Inicia sesión para continuar.'), { status: 401 });
  if (pathname === '/api/users' && method === 'GET') return send(response, 200, await services.getUsers());
  if (pathname === '/api/dashboard' && method === 'GET') return send(response, 200, await services.getDashboard());
  if (pathname === '/api/inventory' && method === 'GET') return send(response, 200, await services.getInventorySnapshot());
  if (pathname === '/api/reservations' && method === 'GET') return send(response, 200, await services.getCollection(actor, 'reservations'));
  if (pathname === '/api/loans' && method === 'GET') return send(response, 200, await services.getCollection(actor, 'loans'));
  if (pathname === '/api/history' && method === 'GET') return send(response, 200, await services.getHistory(actor));
  if (pathname === '/api/wallet' && method === 'GET') return send(response, 200, await services.getWallet(actor));

  const body = await readBody(request);
  if (pathname === '/api/wallet/deposits' && method === 'POST') return send(response, 201, await services.addDemoDeposit(actor, body));
  if (pathname === '/api/wallet/transfers' && method === 'POST') return send(response, 201, await services.transferDemoFunds(actor, body));
  if (pathname === '/api/reservations' && method === 'POST') return send(response, 201, await services.addReservation(actor, body));
  if (pathname === '/api/loans' && method === 'POST') return send(response, 201, await services.addLoan(actor, body));

  let match = pathname.match(/^\/api\/reservations\/([^/]+)$/);
  if (match && method === 'PATCH') return send(response, 200, await services.updateReservation(actor, match[1], body.accion));
  match = pathname.match(/^\/api\/reservations\/([^/]+)\/loan$/);
  if (match && method === 'POST') return send(response, 201, await services.loanFromReservation(actor, match[1], body));
  match = pathname.match(/^\/api\/loans\/([^/]+)\/returns$/);
  if (match && method === 'POST') return send(response, 201, await services.returnLoan(actor, match[1], body));
  match = pathname.match(/^\/api\/inventory\/([^/]+)$/);
  if (match && method === 'PATCH') return send(response, 200, await services.updateInventory(actor, match[1], body.total));
  return send(response, 404, { error: 'Ruta no encontrada.' });
}

module.exports = async function handler(request, response) {
  try {
    const url = new URL(request.url, `https://${request.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) return await handleApi(request, response, url);
    if (request.method !== 'GET') return send(response, 405, { error: 'Método no permitido.' });
    return serveStatic(url.pathname, response);
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500) console.error(error);
    return send(response, status, { error: status >= 500 ? 'Error interno del servidor.' : error.message });
  }
};
