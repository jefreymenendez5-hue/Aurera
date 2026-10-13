function getInventory(state) {
  const inventory = Object.fromEntries(state.resources.map((resource) => [resource.id, {
    id: resource.id,
    nombre: resource.nombre,
    total: resource.total,
    reservadas: 0,
    prestadas: 0,
    devueltas: 0,
    disponibles: 0
  }]));

  for (const reservation of state.reservations) {
    if (!['pendiente', 'confirmada'].includes(reservation.estado)) continue;
    for (const [resourceId, quantity] of Object.entries(reservation.cantidades)) {
      if (inventory[resourceId]) inventory[resourceId].reservadas += quantity;
    }
  }

  for (const loan of state.loans) {
    for (const resourceId of Object.keys(inventory)) {
      const returned = loan.cantidadesDevueltas[resourceId] || 0;
      inventory[resourceId].prestadas += loan.cantidadesIniciales[resourceId] - returned;
    }
  }

  for (const record of state.returns) {
    for (const [resourceId, quantity] of Object.entries(record.cantidades)) {
      if (inventory[resourceId]) inventory[resourceId].devueltas += quantity;
    }
  }

  for (const item of Object.values(inventory)) {
    item.disponibles = item.total - item.reservadas - item.prestadas;
  }
  return Object.values(inventory);
}

function getDashboard(state) {
  const inventory = getInventory(state);
  const today = new Date().toISOString().slice(0, 10);
  const pendingReservations = state.reservations.filter((item) => item.estado === 'pendiente').length;
  const openLoans = state.loans.filter((item) => item.estado !== 'devuelto');
  const overdueLoans = openLoans.filter((item) => item.fechaPrevistaDevolucion < today).length;
  const activeLoans = state.loans.filter((item) => ['activo', 'parcial'].includes(item.estado)).length;

  return {
    inventory,
    reservasPendientes: pendingReservations,
    prestamosActivos: activeLoans,
    prestamosVencidos: overdueLoans,
    devolucionesPendientes: openLoans.length
  };
}

module.exports = { getDashboard, getInventory };