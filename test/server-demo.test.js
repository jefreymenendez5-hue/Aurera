const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

function availablePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

test('la aplicación requiere el acceso único de Jeffrey y no permite crear cuentas', async () => {
  const port = await availablePort();
  const origin = `http://127.0.0.1:${port}`;
  const databasePath = path.join(os.tmpdir(), `aurea-server-test-${process.pid}.json`);
  const server = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(port), MOBILIARIO_DB_PATH: databasePath },
    stdio: 'ignore'
  });

  try {
    let ready = false;
    for (let attempt = 0; attempt < 50 && !ready; attempt += 1) {
      try {
        const response = await fetch(`${origin}/api/users`);
        ready = response.ok;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    assert.equal(ready, true, 'el servidor debe iniciar para la prueba');

    const page = await fetch(origin);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /Iniciar sesión/);
    assert.doesNotMatch(html, /Crear cuenta|Crea tu cuenta/);

    const appScript = await fetch(`${origin}/app.js`);
    const appSource = await appScript.text();
    assert.equal(appScript.status, 200);
    assert.equal((appSource.match(/formElement\.reset\(\)/g) || []).length, 2);
    assert.doesNotMatch(appSource, /event\.currentTarget\.reset\(\)/);
    assert.match(appSource, /button\.addEventListener\('click', \(\) => openLoanDialog\(\)\)/);
    assert.doesNotMatch(appSource, /addEventListener\('click', openLoanDialog\)/);

    assert.match(appSource, /wallet-greeting'\)\.textContent = 'Jeffrey Diddy\.'/);
    assert.match(appSource, /\/api\/auth\/login/);

    const unauthenticated = await fetch(`${origin}/api/users`);
    assert.equal(unauthenticated.status, 401);
    const wallet = await fetch(`${origin}/api/wallet`);
    assert.equal(wallet.status, 401);

    const wrongPassword = await fetch(`${origin}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ correo: 'jefreymenendez5@gmail.com', password: 'no-es-la-clave' })
    });
    assert.equal(wrongPassword.status, 401);

    const login = await fetch(`${origin}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ correo: 'jefreymenendez5@gmail.com', password: 'JeffreyDiddy!Aurea2026' })
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    assert.match(login.headers.get('set-cookie'), /HttpOnly/);
    assert.match(login.headers.get('set-cookie'), /SameSite=Strict/);

    const session = await fetch(`${origin}/api/auth/session`, { headers: { Cookie: cookie } });
    assert.equal((await session.json()).user.correo, 'jefreymenendez5@gmail.com');

    const users = await fetch(`${origin}/api/users`, { headers: { Cookie: cookie } });
    const userList = await users.json();
    assert.equal(userList.find((user) => user.id === 'admin').nombre, 'Jeffrey Diddy');

    const walletAfterLogin = await fetch(`${origin}/api/wallet`, { headers: { Cookie: cookie } });
    assert.equal(walletAfterLogin.status, 200);

    const deposit = await fetch(`${origin}/api/wallet/deposits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin, Cookie: cookie },
      body: JSON.stringify({ importe: '25.00' })
    });
    assert.equal(deposit.status, 201);
    assert.equal((await deposit.json()).saldoCentavos, 2500);

    const registration = await fetch(`${origin}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({})
    });
    assert.equal(registration.status, 401);

    const logout = await fetch(`${origin}/api/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin, Cookie: cookie },
      body: '{}'
    });
    assert.equal(logout.status, 200);
    const expiredSession = await fetch(`${origin}/api/auth/session`, { headers: { Cookie: cookie } });
    assert.equal((await expiredSession.json()).user, null);
  } finally {
    server.kill('SIGTERM');
    await new Promise((resolve) => server.once('exit', resolve));
    fs.rmSync(databasePath, { force: true });
  }
});
