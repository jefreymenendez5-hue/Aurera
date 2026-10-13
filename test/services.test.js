const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const databasePath = path.join(os.tmpdir(), `mobiliario-test-${process.pid}.json`);
process.env.MOBILIARIO_DB_PATH = databasePath;
const services = require('../src/services');

test('el administrador puede crear reservas para un responsable libre y personalizado', async () => {
  try {
    const admin = await services.findActor('admin');
    const date = new Date().toISOString().slice(0, 10);
    const reservation = await services.addReservation(admin, {
      fecha: date,
      usuarioNombre: 'Sofía García',
      cantidades: { mesas: 1, sillas: 2 }
    });
    assert.equal(reservation.usuarioNombre, 'Sofía García');
    assert.ok((await services.getUsers()).some((user) => user.nombre === 'Sofía García'));
  } finally {
    fs.rmSync(databasePath, { force: true });
  }
});

test('el inventario conserva sus cantidades en reservas, préstamos y devoluciones parciales', async () => {
  try {
    const admin = await services.findActor('admin');
    const user = await services.findActor('usuario');
    const date = new Date().toISOString().slice(0, 10);
    const initial = await services.getInventorySnapshot();
    assert.deepEqual(initial.map(({ id, total, disponibles }) => [id, total, disponibles]), [
      ['mesas', 20, 20], ['sillas', 100, 100]
    ]);

    await assert.rejects(
      services.addReservation(user, { fecha: '2026-02-31', cantidades: { mesas: 1, sillas: 0 } }),
      { status: 400 }
    );
    const reservation = await services.addReservation(user, {
      fecha: date,
      cantidades: { mesas: 5, sillas: 20 }
    });
    let inventory = await services.getInventorySnapshot();
    assert.deepEqual(inventory.map(({ disponibles, reservadas, prestadas }) => [disponibles, reservadas, prestadas]), [
      [15, 5, 0], [80, 20, 0]
    ]);

    const competingReservations = await Promise.allSettled([
      services.addReservation(user, { fecha: date, cantidades: { mesas: 14, sillas: 0 } }),
      services.addReservation(user, { fecha: date, cantidades: { mesas: 2, sillas: 0 } })
    ]);
    assert.equal(competingReservations.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(competingReservations.filter((result) => result.status === 'rejected' && result.reason.status === 409).length, 1);

    await services.updateReservation(admin, reservation.id, 'confirmar');
    const loan = await services.loanFromReservation(admin, reservation.id, {
      fechaPrestamo: date,
      fechaPrevistaDevolucion: date
    });
    inventory = await services.getInventorySnapshot();
    assert.deepEqual(inventory.map(({ disponibles, reservadas, prestadas }) => [disponibles, reservadas, prestadas]), [
      [1, 14, 5], [80, 0, 20]
    ]);

    await assert.rejects(
      services.loanFromReservation(admin, reservation.id, { fechaPrestamo: date, fechaPrevistaDevolucion: date }),
      { status: 409 }
    );
    await assert.rejects(
      services.returnLoan(user, loan.id, { cantidades: { mesas: 0, sillas: 1 } }),
      { status: 403 }
    );

    const partial = await services.returnLoan(admin, loan.id, { cantidades: { mesas: 3, sillas: 10 } });
    assert.equal(partial.prestamo.estado, 'parcial');
    inventory = await services.getInventorySnapshot();
    assert.deepEqual(inventory.map(({ disponibles, reservadas, prestadas, devueltas }) => [disponibles, reservadas, prestadas, devueltas]), [
      [4, 14, 2, 3], [90, 0, 10, 10]
    ]);

    await assert.rejects(
      services.returnLoan(admin, loan.id, { cantidades: { mesas: 3, sillas: 0 } }),
      { status: 409 }
    );
    const complete = await services.returnLoan(admin, loan.id, { cantidades: { mesas: 2, sillas: 10 } });
    assert.equal(complete.prestamo.estado, 'devuelto');
    inventory = await services.getInventorySnapshot();
    assert.deepEqual(inventory.map(({ disponibles, reservadas, prestadas }) => [disponibles, reservadas, prestadas]), [
      [6, 14, 0], [100, 0, 0]
    ]);

    const movements = await services.getHistory(admin);
    assert.equal(movements.filter((movement) => movement.tipo === 'devolucion').length, 2);
  } finally {
    fs.rmSync(databasePath, { force: true });
  }
});