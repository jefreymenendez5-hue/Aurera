const fs = require('node:fs');
const path = require('node:path');

const dataDirectory = path.join(__dirname, '..', 'data');
const databasePath = process.env.MOBILIARIO_DB_PATH || path.join(dataDirectory, 'db.json');
let writeQueue = Promise.resolve();
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
    const state = readState();
    const result = work(state);
    persistState(state);
    return result;
  });
  writeQueue = operation.catch(() => {});
  return operation;
}

async function read(work) {
  await writeQueue;
  return work(readState());
}

module.exports = { read, transact };