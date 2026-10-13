const fs = require('node:fs');
const path = require('node:path');
const { Pool, neonConfig } = require('@neondatabase/serverless');
const WebSocket = require('ws');

const dataDirectory = path.join(__dirname, '..', 'data');
const databasePath = process.env.MOBILIARIO_DB_PATH || path.join(dataDirectory, 'db.json');
let writeQueue = Promise.resolve();
let postgresPool;
let postgresInitialization;
const demoAdminPasswordHash = '962cb2fd0153afb194c39886f22c4b2b:7be1803d91ee8ed843cf37be327346958d3ed4172967712986eb1a517278051a67dd4e3ac7adce0facea536a2c836bfc3bbd986d76c83c12e46d6961793d33f8';

function createInitialState() {
  return {
    users: [
      {
        id: 'admin',
        nombre: 'Jeffrey Diddy',
        correo: 'jefreymenendez5@gmail.com',
        rol: 'admin',
        passwordHash: '962cb2fd0153afb194c39886f22c4b2b:7be1803d91ee8ed843cf37be327346958d3ed4172967712986eb1a517278051a67dd4e3ac7adce0facea536a2c836bfc3bbd986d76c83c12e46d6961793d33f8'
      },
      { id: 'usuario', nombre: 'Camila Torres', correo: 'camila@ejemplo.com', rol: 'usuario' }
    ],
    resources: [
      { id: 'mesas', nombre: 'Mesas', total: 20 },
      { id: 'sillas', nombre: 'Sillas', total: 100 }
    ],
    reservations: [],
    loans: [],
    returns: [],
    history: []
  };
}

function getPostgresPool() {
  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!connectionString) {
    if (process.env.VERCEL) throw new Error('Configura DATABASE_URL o POSTGRES_URL para usar la base de datos persistente en Vercel.');
    return null;
  }
  if (!postgresPool) {
    neonConfig.webSocketConstructor = WebSocket;
    postgresPool = new Pool({ connectionString, max: 1 });
  }
  return postgresPool;
}

async function initializePostgres(pool) {
  if (!postgresInitialization) {
    postgresInitialization = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS aurea_app_state (
          id TEXT PRIMARY KEY,
          state JSONB NOT NULL
        )
      `);
      await pool.query(
        'INSERT INTO aurea_app_state (id, state) VALUES ($1, $2::jsonb) ON CONFLICT (id) DO NOTHING',
        ['main', JSON.stringify(createInitialState())]
      );
    })().catch((error) => {
      postgresInitialization = null;
      throw error;
    });
  }
  await postgresInitialization;
}

function ensureDatabase() {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  if (!fs.existsSync(databasePath)) {
    fs.writeFileSync(databasePath, `${JSON.stringify(createInitialState(), null, 2)}\n`);
    return;
  }

  const state = JSON.parse(fs.readFileSync(databasePath, 'utf8'));
  const admin = state.users?.find((user) => user.id === 'admin');
  if (!admin) return;
  let changed = false;
  if (admin.nombre !== 'Jeffrey Diddy') {
    admin.nombre = 'Jeffrey Diddy';
    changed = true;
  }
  if (admin.correo !== 'jefreymenendez5@gmail.com') {
    admin.correo = 'jefreymenendez5@gmail.com';
    changed = true;
  }
  if (!admin.passwordHash) {
    admin.passwordHash = demoAdminPasswordHash;
    changed = true;
  }
  if (changed) persistState(state);
}

function readState() {
  ensureDatabase();
  return JSON.parse(fs.readFileSync(databasePath, 'utf8'));
}

function persistState(state) {
  const temporaryPath = `${databasePath}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`);
  fs.renameSync(temporaryPath, databasePath);
}

function transact(work) {
  const operation = writeQueue.then(() => {
    const pool = getPostgresPool();
    if (pool) return transactPostgres(pool, work);
    const state = readState();
    const result = work(state);
    persistState(state);
    return result;
  });
  writeQueue = operation.catch(() => {});
  return operation;
}

async function transactPostgres(pool, work) {
  await initializePostgres(pool);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query('SELECT state FROM aurea_app_state WHERE id = $1 FOR UPDATE', ['main']);
    const state = result.rows[0].state;
    const value = work(state);
    await client.query('UPDATE aurea_app_state SET state = $1::jsonb WHERE id = $2', [JSON.stringify(state), 'main']);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function read(work) {
  await writeQueue;
  const pool = getPostgresPool();
  if (!pool) return work(readState());
  await initializePostgres(pool);
  const result = await pool.query('SELECT state FROM aurea_app_state WHERE id = $1', ['main']);
  return work(result.rows[0].state);
}

module.exports = { read, transact };