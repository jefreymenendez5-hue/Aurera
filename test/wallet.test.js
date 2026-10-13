const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const databasePath = path.join(os.tmpdir(), `aurea-wallet-test-${process.pid}.json`);
process.env.MOBILIARIO_DB_PATH = databasePath;
const services = require('../src/services');

test('la billetera abierta conserva saldo y transferencias de demostración', async () => {
  try {
    const admin = await services.findActor('admin');
    const recipient = await services.findActor('usuario');

    await services.addDemoDeposit(admin, { importe: '100.01' });
    await services.transferDemoFunds(admin, { correo: recipient.correo, importe: '30.50' });
    assert.equal((await services.getWallet(admin)).saldoCentavos, 6951);
    const recipientWallet = await services.getWallet(recipient);
    assert.equal(recipientWallet.saldoCentavos, 3050);
    assert.equal(recipientWallet.transacciones.length, 1);
    assert.equal(recipientWallet.transacciones[0].direccion, 'entrada');

    await assert.rejects(
      services.transferDemoFunds(admin, { correo: recipient.correo, importe: '70.00' }),
      { status: 409 }
    );
    await assert.rejects(
      services.transferDemoFunds(admin, { correo: admin.correo, importe: '1.00' }),
      { status: 400 }
    );
    await assert.rejects(
      services.addDemoDeposit(admin, { importe: '10000.01' }),
      { status: 400 }
    );
    assert.equal((await services.getWallet(admin)).saldoCentavos, 6951);
  } finally {
    fs.rmSync(databasePath, { force: true });
  }
});
