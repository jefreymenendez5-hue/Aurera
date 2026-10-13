const { randomUUID } = require('node:crypto');
const store = require('./store');
const { getDashboard: buildDashboard, getInventory } = require('./inventory');

const today = () => new Date().toISOString().slice(0, 10);
const now = () => new Date().toISOString();
const fail = (status, message) => Object.assign(new Error(message), { status });

function requireUser(state, id) {
  const user = state.users.find((item) => item.id === id);
  if (!user) throw fail(401, 'Selecciona un usuario válido.');
  return user;
}

function normalizeUserName(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function resolveOwner(state, actor, body) {
  const customName = normalizeUserName(body?.usuarioNombre);
  const existingId = typeof body?.usuarioId === 'string' ? body.usuarioId.trim() : '';
  if (actor.rol === 'admin') {
    if (customName) {
      const existing = state.users.find((user) => user.nombre.trim().toLowerCase() === customName.toLowerCase());
      if (existing) return existing;
      const user = {
        id: randomUUID(), nombre: customName, correo: `${customName.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '')}.${randomUUID().slice(0, 8)}@local.demo`, rol: 'usuario'
      };
      state.users.push(user);
      return user;
    }
    if (existingId) return requireUser(state, existingId);
  }
  return actor;
}

function requireAdmin(user) {
  if (user.rol !== 'admin') throw fail(403, 'Esta operación requiere permisos de administrador.');
}

function recordMovement(state, actor, type, entity, quantities, previous, next, ownerId = actor.id) {
  state.history.unshift({
    id: randomUUID(),
    usuarioId: actor.id,
    usuarioNombre: actor.nombre,
    propietarioId: ownerId,
    tipo: type,
    entidadId: entity.id,
    cantidades: { ...quantities },
    fecha: now(),
    estadoAnterior: previous,
    estadoPosterior: next
  });
}

function normalizeQuantities(state, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw fail(400, 'Indica cantidades válidas para mesas y sillas.');
  }
  const quantities = {};
  for (const resource of state.resources) {
    const quantity = input[resource.id] ?? 0;
    if (!Number.isInteger(quantity) || quantity < 0) {
      throw fail(400, `La cantidad de ${resource.nombre.toLowerCase()} debe ser un entero no negativo.`);
    }
    quantities[resource.id] = quantity;
  }
  if (Object.values(quantities).every((quantity) => quantity === 0)) {
    throw fail(400, 'La operación debe incluir al menos un recurso.');
  }
  return quantities;
}

function assertAvailable(state, quantities) {
  const available = Object.fromEntries(getInventory(state).map((item) => [item.id, item.disponibles]));
  for (const [resourceId, quantity] of Object.entries(quantities)) {
    if (quantity > available[resourceId]) {
      const resource = state.resources.find((item) => item.id === resourceId);
      throw fail(409, `Solo hay ${available[resourceId]} ${resource.nombre.toLowerCase()} disponibles.`);
    }
  }
}

function validDate(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw fail(400, `Indica una fecha válida para ${label}.`);
  }
  if (new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw fail(400, `Indica una fecha válida para ${label}.`);
  }
  return value;
}

function effectiveLoanStatus(loan) {
  const fullyReturned = Object.entries(loan.cantidadesIniciales)
    .every(([resourceId, initial]) => initial === loan.cantidadesDevueltas[resourceId]);
  if (fullyReturned) return 'devuelto';
  if (loan.fechaPrevistaDevolucion < today()) return 'vencido';
  if (Object.values(loan.cantidadesDevueltas).some((quantity) => quantity > 0)) return 'parcial';
  return 'activo';
}

function refreshExpiredLoans(state) {
  const actor = state.users.find((user) => user.rol === 'admin') || state.users[0];
  for (const loan of state.loans) {
    const status = effectiveLoanStatus(loan);
    if (loan.estado !== status) {
      const previous = loan.estado;
      loan.estado = status;
      recordMovement(state, actor, 'cambio_estado', loan, loan.cantidadesIniciales, previous, status, loan.usuarioId);
    }
  }
}

async function withFreshState(work) {
  return store.transact((state) => {
    refreshExpiredLoans(state);
    return work(state);
  });
}

function visibleTo(state, user, collection) {
  return user.rol === 'admin' ? collection : collection.filter((item) => item.usuarioId === user.id);
}

function createReservation(state, actor, body) {
  const owner = resolveOwner(state, actor, body);
  const quantities = normalizeQuantities(state, body.cantidades);
  assertAvailable(state, quantities);
  const fecha = validDate(body.fecha, 'la reserva');
  if (fecha < today()) throw fail(400, 'La fecha de la reserva no puede estar en el pasado.');
  const horaInicio = body.horaInicio || '';
  const horaFin = body.horaFin || '';
  const validTime = (value) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  if ((horaInicio || horaFin) && (!validTime(horaInicio) || !validTime(horaFin) || horaFin <= horaInicio)) {
    throw fail(400, 'La hora de finalización debe ser posterior a la hora de inicio.');
  }
  const reservation = {
    id: randomUUID(), usuarioId: owner.id, usuarioNombre: owner.nombre,
    fecha, horaInicio, horaFin, cantidades: quantities, estado: 'pendiente', creadaEn: now()
  };
  state.reservations.unshift(reservation);
  recordMovement(state, actor, 'reserva', reservation, quantities, null, 'pendiente', owner.id);
  return reservation;
}

function changeReservation(state, actor, reservationId, action) {
  const reservation = state.reservations.find((item) => item.id === reservationId);
  if (!reservation) throw fail(404, 'No se encontró la reserva.');
  const isOwner = reservation.usuarioId === actor.id;
  if (action === 'confirmar') {
    requireAdmin(actor);
    if (reservation.estado !== 'pendiente') throw fail(409, 'Solo se pueden confirmar reservas pendientes.');
    const previous = reservation.estado;
    reservation.estado = 'confirmada';
    recordMovement(state, actor, 'reserva', reservation, reservation.cantidades, previous, reservation.estado, reservation.usuarioId);
  } else if (action === 'cancelar') {
    if (!isOwner) requireAdmin(actor);
    if (!['pendiente', 'confirmada'].includes(reservation.estado)) throw fail(409, 'Esta reserva ya no se puede cancelar.');
    if (reservation.fecha < today()) throw fail(409, 'No se puede cancelar una reserva pasada.');
    const previous = reservation.estado;
    reservation.estado = 'cancelada';
    recordMovement(state, actor, 'cancelacion', reservation, reservation.cantidades, previous, reservation.estado, reservation.usuarioId);
  } else {
    throw fail(400, 'Acción de reserva no válida.');
  }
  return reservation;
}

function createLoan(state, actor, body, reservation = null) {
  requireAdmin(actor);
  const owner = reservation ? requireUser(state, reservation.usuarioId) : resolveOwner(state, actor, body);
  const quantities = reservation ? { ...reservation.cantidades } : normalizeQuantities(state, body.cantidades);
  if (!reservation) assertAvailable(state, quantities);
  const fechaPrestamo = validDate(body.fechaPrestamo || today(), 'el préstamo');
  const fechaPrevistaDevolucion = validDate(body.fechaPrevistaDevolucion, 'la devolución prevista');
  if (fechaPrevistaDevolucion < fechaPrestamo) throw fail(400, 'La devolución prevista no puede ser anterior al préstamo.');
  const loan = {
    id: randomUUID(), usuarioId: owner.id, usuarioNombre: owner.nombre,
    reservaId: reservation?.id || null,
    fechaPrestamo, fechaPrevistaDevolucion,
    cantidadesIniciales: quantities,
    cantidadesDevueltas: Object.fromEntries(Object.keys(quantities).map((id) => [id, 0])),
    estado: 'activo', observaciones: String(body.observaciones || '').trim(), creadoEn: now()
  };
  state.loans.unshift(loan);
  if (reservation) reservation.estado = 'finalizada';
  recordMovement(state, actor, 'prestamo', loan, quantities, reservation ? 'confirmada' : null, 'activo', owner.id);
  return loan;
}

async function getDashboard() {
  return withFreshState((state) => buildDashboard(state));
}

async function getInventorySnapshot() {
  return store.read((state) => getInventory(state));
}

async function getCollection(actor, type) {
  return withFreshState((state) => {
    const key = type === 'reservations' ? 'reservations' : 'loans';
    return visibleTo(state, actor, state[key]);
  });
}

async function getHistory(actor) {
  return store.read((state) => actor.rol === 'admin'
    ? state.history
    : state.history.filter((item) => item.propietarioId === actor.id || item.usuarioId === actor.id));
}

async function addReservation(actor, body) {
  return withFreshState((state) => createReservation(state, actor, body));
}

async function updateReservation(actor, reservationId, action) {
  return withFreshState((state) => changeReservation(state, actor, reservationId, action));
}

async function addLoan(actor, body) {
  return withFreshState((state) => createLoan(state, actor, body));
}

async function loanFromReservation(actor, reservationId, body) {
  return withFreshState((state) => {
    const reservation = state.reservations.find((item) => item.id === reservationId);
    if (!reservation) throw fail(404, 'No se encontró la reserva.');
    if (reservation.estado !== 'confirmada') throw fail(409, 'Confirma la reserva antes de registrar el préstamo.');
    return createLoan(state, actor, body, reservation);
  });
}

async function returnLoan(actor, loanId, body) {
  return withFreshState((state) => {
    requireAdmin(actor);
    const loan = state.loans.find((item) => item.id === loanId);
    if (!loan) throw fail(404, 'No se encontró el préstamo.');
    if (loan.estado === 'devuelto') throw fail(409, 'Este préstamo ya fue devuelto por completo.');
    const quantities = normalizeQuantities(state, body.cantidades);
    for (const [resourceId, quantity] of Object.entries(quantities)) {
      const pending = loan.cantidadesIniciales[resourceId] - loan.cantidadesDevueltas[resourceId];
      if (quantity > pending) {
        const resource = state.resources.find((item) => item.id === resourceId);
        throw fail(409, `La devolución supera las ${pending} ${resource.nombre.toLowerCase()} pendientes.`);
      }
    }
    const previous = loan.estado;
    for (const [resourceId, quantity] of Object.entries(quantities)) {
      loan.cantidadesDevueltas[resourceId] += quantity;
    }
    const returned = { id: randomUUID(), prestamoId: loan.id, cantidades: quantities, fechaReal: now(), observaciones: String(body.observaciones || '').trim() };
    state.returns.unshift(returned);
    loan.estado = effectiveLoanStatus(loan);
    recordMovement(state, actor, 'devolucion', loan, quantities, previous, loan.estado, loan.usuarioId);
    return { devolucion: returned, prestamo: loan };
  });
}

async function updateInventory(actor, resourceId, total) {
  return withFreshState((state) => {
    requireAdmin(actor);
    const resource = state.resources.find((item) => item.id === resourceId);
    if (!resource) throw fail(404, 'No se encontró el recurso.');
    if (!Number.isInteger(total) || total < 0) throw fail(400, 'El total debe ser un entero no negativo.');
    const current = getInventory(state).find((item) => item.id === resourceId);
    if (total < current.reservadas + current.prestadas) throw fail(409, 'El total no puede ser inferior a los recursos comprometidos.');
    const previous = resource.total;
    resource.total = total;
    recordMovement(state, actor, 'modificacion', resource, { [resourceId]: total - previous }, previous, total);
    return getInventory(state).find((item) => item.id === resourceId);
  });
}

async function getUsers() {
  return store.read((state) => state.users.map((user) => ({
    id: user.id, nombre: user.nombre, correo: user.correo, rol: user.rol
  })));
}

function findActor(userId) {
  return store.read((state) => requireUser(state, userId));
}

function getWalletBalance(state, userId) {
  return (state.walletTransactions || []).reduce((balance, transaction) => {
    if (transaction.tipo === 'recarga_demo' && transaction.destinatarioId === userId) return balance + transaction.centavos;
    if (transaction.tipo === 'transferencia' && transaction.destinatarioId === userId) return balance + transaction.centavos;
    if (transaction.tipo === 'transferencia' && transaction.remitenteId === userId) return balance - transaction.centavos;
    return balance;
  }, 0);
}

async function getWallet(actor) {
  return store.read((state) => {
    const users = new Map(state.users.map((user) => [user.id, user]));
    const transactions = (state.walletTransactions || [])
      .filter((transaction) => transaction.remitenteId === actor.id || transaction.destinatarioId === actor.id)
      .map((transaction) => {
        const outgoing = transaction.remitenteId === actor.id;
        const otherId = outgoing ? transaction.destinatarioId : transaction.remitenteId;
        return {
          id: transaction.id,
          tipo: transaction.tipo,
          centavos: transaction.centavos,
          direccion: outgoing ? 'salida' : 'entrada',
          contraparte: otherId ? users.get(otherId)?.nombre || 'Cuenta' : 'Saldo de demostración',
          creadoEn: transaction.creadoEn
        };
      });
    return { saldoCentavos: getWalletBalance(state, actor.id), transacciones: transactions };
  });
}

function parseAmountToCents(value) {
  const amount = typeof value === 'number' ? String(value) : value;
  if (typeof amount !== 'string' || !/^(?:0|[1-9]\d{0,4})(?:\.\d{1,2})?$/.test(amount)) {
    throw fail(400, 'Indica un importe válido de hasta 10 000,00.');
  }
  const [whole, fraction = ''] = amount.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (cents < 1 || cents > 1_000_000) throw fail(400, 'El importe debe estar entre 0,01 y 10 000,00.');
  return cents;
}

async function addDemoDeposit(actor, body) {
  const cents = parseAmountToCents(body.importe);
  return store.transact((state) => {
    state.walletTransactions ||= [];
    state.walletTransactions.unshift({
      id: randomUUID(), tipo: 'recarga_demo', centavos: cents,
      remitenteId: null, destinatarioId: actor.id, creadoEn: now()
    });
    return { saldoCentavos: getWalletBalance(state, actor.id) };
  });
}

async function transferDemoFunds(actor, body) {
  const correo = typeof body.correo === 'string' ? body.correo.trim().toLowerCase() : '';
  if (correo.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) throw fail(400, 'Escribe el correo de una cuenta válida.');
  const cents = parseAmountToCents(body.importe);
  return store.transact((state) => {
    const recipient = state.users.find((user) => user.correo.toLowerCase() === correo);
    if (!recipient) throw fail(404, 'No se encontró una cuenta registrada con ese correo.');
    if (recipient.id === actor.id) throw fail(400, 'No puedes enviarte saldo a tu propia cuenta.');
    const balance = getWalletBalance(state, actor.id);
    if (cents > balance) throw fail(409, 'No tienes saldo de demostración suficiente.');
    state.walletTransactions ||= [];
    state.walletTransactions.unshift({
      id: randomUUID(), tipo: 'transferencia', centavos: cents,
      remitenteId: actor.id, destinatarioId: recipient.id, creadoEn: now()
    });
    return { saldoCentavos: balance - cents };
  });
}

module.exports = {
  addDemoDeposit, addLoan, addReservation, findActor, getCollection, getDashboard, getHistory,
  getInventorySnapshot, getUsers, getWallet, loanFromReservation, returnLoan,
  transferDemoFunds, updateInventory, updateReservation
};