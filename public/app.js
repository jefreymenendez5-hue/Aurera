const state = { user: null, users: [], inventory: [], reservations: [], loans: [], history: [], wallet: null, returnLoan: null, loanReservation: null };
const resourceNames = { mesas: 'mesas', sillas: 'sillas' };
const statusLabels = { pendiente: 'Pendiente', confirmada: 'Confirmada', cancelada: 'Cancelada', finalizada: 'Finalizada', activo: 'Activo', parcial: 'Devolución parcial', devuelto: 'Devuelto', vencido: 'Vencido' };
const movementLabels = { reserva: 'Nueva reserva', cancelacion: 'Reserva cancelada', prestamo: 'Préstamo registrado', devolucion: 'Devolución', modificacion: 'Inventario modificado', cambio_estado: 'Estado actualizado' };

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const formatDate = (value) => value ? new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value.slice(0, 10)}T00:00:00Z`)) : '—';
const formatDateTime = (value) => new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
const quantityText = (quantities, includeZero = false) => Object.entries(quantities || {}).filter(([, count]) => includeZero ? count >= 0 : count > 0).map(([id, count]) => `${count} ${resourceNames[id] || id}`).join(' · ') || 'Sin recursos';

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...options.headers }
  });
  const body = await response.json();
  if (!response.ok) {
    if (response.status === 401 && state.user) showLogin();
    throw new Error(body.error || 'No se pudo completar la operación.');
  }
  return body;
}

function showLogin() {
  state.user = null;
  $('#app-shell').hidden = true;
  $('#login-screen').hidden = false;
  $('#login-form').reset();
  $('#login-email').value = 'jefreymenendez5@gmail.com';
}

function showToast(message, kind = 'success') {
  const toast = $('#toast');
  toast.textContent = message;
  toast.className = `toast is-visible ${kind === 'error' ? 'is-error' : ''}`;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('is-visible'), 3200);
}

function setFormError(id, message) {
  const element = $(`#${id}`);
  element.textContent = message;
  element.hidden = !message;
}

function statusTag(status) {
  return `<span class="status status-${escapeHtml(status)}"><span></span>${escapeHtml(statusLabels[status] || status)}</span>`;
}

function renderInventory() {
  $('#inventory-grid').innerHTML = state.inventory.map((resource) => {
    const ratio = resource.total ? Math.round((resource.disponibles / resource.total) * 100) : 0;
    const accent = resource.id === 'mesas' ? 'mint' : 'orange';
    return `<article class="inventory-card inventory-${accent}">
      <div class="inventory-card-top"><span class="resource-icon" aria-hidden="true">${resource.id === 'mesas' ? 'M' : 'S'}</span><span class="inventory-share">${ratio}% LIBRE</span></div>
      <div class="resource-title-row"><h3>${escapeHtml(resource.nombre)}</h3><span class="resource-total">${resource.total} en total</span></div>
      <div class="availability-number"><strong>${resource.disponibles}</strong><span>disponibles</span></div>
      <div class="stock-track" role="img" aria-label="${resource.disponibles} de ${resource.total} ${resource.nombre.toLowerCase()} disponibles"><span style="width:${ratio}%"></span></div>
      <div class="inventory-breakdown"><span><i class="key-dot reserved-dot"></i>Reservadas <b>${resource.reservadas}</b></span><span><i class="key-dot loaned-dot"></i>Prestadas <b>${resource.prestadas}</b></span><span><i class="key-dot returned-dot"></i>Devueltas <b>${resource.devueltas}</b></span></div>
      ${state.user?.rol === 'admin' ? `<button class="edit-stock" data-edit-stock="${resource.id}">Ajustar inventario <span aria-hidden="true">↗</span></button>` : ''}
    </article>`;
  }).join('');
  for (const id of ['mesas', 'sillas']) {
    const quantity = state.inventory.find((resource) => resource.id === id)?.disponibles ?? 0;
    $(`#${id === 'mesas' ? 'tables-available' : 'chairs-available'}`).textContent = `${quantity} disponibles`;
    $(`#loan-${id === 'mesas' ? 'tables' : 'chairs'}-available`).textContent = `${quantity} disponibles`;
  }
}

function renderMetrics(dashboard) {
  const cards = [
    ['Solicitudes pendientes', dashboard.reservasPendientes, 'reservas', '◷'],
    ['Préstamos activos', dashboard.prestamosActivos, 'entregas en curso', '⇄'],
    ['Préstamos vencidos', dashboard.prestamosVencidos, 'requieren seguimiento', '!', dashboard.prestamosVencidos > 0],
    ['Devoluciones pendientes', dashboard.devolucionesPendientes, 'préstamos por cerrar', '↩']
  ];
  $('#metric-grid').innerHTML = cards.map(([label, count, detail, icon, alert]) => `<article class="metric-item ${alert ? 'metric-alert' : ''}"><span class="metric-icon">${icon}</span><div><p>${label}</p><strong>${count}</strong><span>${detail}</span></div></article>`).join('');
}

function reservationActions(reservation) {
  if (state.user.rol === 'admin' && reservation.estado === 'pendiente') {
    return `<button class="row-action" data-action="confirmar" data-id="${reservation.id}">Aprobar</button><button class="row-action row-action-muted" data-action="cancelar" data-id="${reservation.id}">Cancelar</button>`;
  }
  if (state.user.rol === 'admin' && reservation.estado === 'confirmada') {
    return `<button class="row-action" data-action="loan" data-id="${reservation.id}">Registrar préstamo</button><button class="row-action row-action-muted" data-action="cancelar" data-id="${reservation.id}">Cancelar</button>`;
  }
  if (['pendiente', 'confirmada'].includes(reservation.estado) && reservation.fecha >= new Date().toISOString().slice(0, 10)) {
    return `<button class="row-action row-action-muted" data-action="cancelar" data-id="${reservation.id}">Cancelar</button>`;
  }
  if (state.user.rol === 'admin' && reservation.estado === 'confirmada') {
    return `<button class="row-action" data-action="loan" data-id="${reservation.id}">Registrar préstamo</button>`;
  }
  return '<span class="no-action">—</span>';
}

function renderReservations() {
  const items = state.reservations;
  const rows = items.map((item) => `<tr>
    <td><span class="person-name">${escapeHtml(item.usuarioNombre)}</span><span class="cell-secondary">${item.horaInicio ? `${escapeHtml(item.horaInicio)} – ${escapeHtml(item.horaFin)}` : 'Reserva de mobiliario'}</span></td>
    <td>${formatDate(item.fecha)}</td><td>${item.horaInicio ? `${escapeHtml(item.horaInicio)} – ${escapeHtml(item.horaFin)}` : 'Sin horario'}</td>
    <td>${escapeHtml(quantityText(item.cantidades))}</td><td>${statusTag(item.estado)}</td><td><div class="row-actions">${reservationActions(item)}</div></td>
  </tr>`).join('');
  $('#reservations-table').innerHTML = rows;
  $('#recent-reservations').innerHTML = items.slice(0, 4).map((item) => `<tr>
    <td><span class="person-name">${escapeHtml(item.usuarioNombre)}</span></td><td>${formatDate(item.fecha)}</td><td>${escapeHtml(quantityText(item.cantidades))}</td><td>${statusTag(item.estado)}</td><td>${reservationActions(item)}</td>
  </tr>`).join('');
  $('#reservation-count').textContent = `${items.length} ${items.length === 1 ? 'solicitud' : 'solicitudes'}`;
  $('#reservations-empty').hidden = items.length > 0;
  $('#recent-empty').hidden = items.length > 0;
}

function loanBalance(loan) {
  return Object.fromEntries(Object.keys(loan.cantidadesIniciales).map((id) => [id, loan.cantidadesIniciales[id] - (loan.cantidadesDevueltas[id] || 0)]));
}

function renderLoans() {
  const items = state.loans;
  $('#loans-table').innerHTML = items.map((loan) => {
    const balance = loanBalance(loan);
    const pending = Object.values(balance).some((count) => count > 0);
    const note = loan.observaciones ? `<span class="cell-secondary">${escapeHtml(loan.observaciones)}</span>` : '';
    return `<tr>
      <td><span class="person-name">${escapeHtml(loan.usuarioNombre)}</span>${note}</td><td>${formatDate(loan.fechaPrestamo)}</td><td>${formatDate(loan.fechaPrevistaDevolucion)}</td>
      <td>${escapeHtml(quantityText(balance))}</td><td>${statusTag(loan.estado)}</td>
      <td>${pending && state.user.rol === 'admin' ? `<button class="row-action" data-return-id="${loan.id}">Registrar devolución</button>` : '<span class="no-action">—</span>'}</td>
    </tr>`;
  }).join('');
  $('#loan-count').textContent = `${items.length} ${items.length === 1 ? 'préstamo' : 'préstamos'}`;
  $('#loans-empty').hidden = items.length > 0;
}

function renderHistory() {
  const items = state.history;
  $('#history-table').innerHTML = items.map((item) => {
    const detail = item.estadoAnterior == null ? statusLabels[item.estadoPosterior] : `${statusLabels[item.estadoAnterior] || item.estadoAnterior} → ${statusLabels[item.estadoPosterior] || item.estadoPosterior}`;
    return `<tr><td><span class="person-name">${escapeHtml(movementLabels[item.tipo] || item.tipo)}</span></td><td>${escapeHtml(item.usuarioNombre)}</td><td>${escapeHtml(quantityText(item.cantidades))}</td><td>${escapeHtml(detail)}</td><td>${formatDateTime(item.fecha)}</td></tr>`;
  }).join('');
  $('#history-empty').hidden = items.length > 0;
}

const formatMoney = (cents) => new Intl.NumberFormat('es-US', { style: 'currency', currency: 'USD' }).format(cents / 100);

function renderWallet() {
  const wallet = state.wallet;
  $('#wallet-balance').textContent = formatMoney(wallet.saldoCentavos);
  $('#wallet-transactions').innerHTML = wallet.transacciones.map((transaction) => {
    const outgoing = transaction.direccion === 'salida';
    const label = transaction.tipo === 'recarga_demo' ? 'Recarga de prueba' : outgoing ? 'Saldo enviado' : 'Saldo recibido';
    return `<tr><td><span class="person-name">${label}</span></td><td>${escapeHtml(transaction.contraparte)}</td><td>${formatDateTime(transaction.creadoEn)}</td><td class="${outgoing ? 'amount-outgoing' : 'amount-incoming'}">${outgoing ? '−' : '+'}${formatMoney(transaction.centavos)}</td></tr>`;
  }).join('');
  $('#wallet-empty').hidden = wallet.transacciones.length > 0;
}

function updateIdentity() {
  const isAdmin = state.user.rol === 'admin';
  $$('.admin-only').forEach((element) => { element.hidden = !isAdmin; });
  $('#user-avatar').textContent = state.user.nombre.slice(0, 1).toUpperCase();
  $('#user-name').textContent = state.user.nombre;
  $('#wallet-greeting').textContent = 'Jeffrey Diddy.';
}

async function refresh() {
  const [dashboard, reservations, loans, history, wallet] = await Promise.all([
    api('/api/dashboard'), api('/api/reservations'), api('/api/loans'), api('/api/history'), api('/api/wallet')
  ]);
  state.inventory = dashboard.inventory;
  state.reservations = reservations;
  state.loans = loans;
  state.history = history;
  state.wallet = wallet;
  renderWallet();
  renderInventory();
  renderMetrics(dashboard);
  renderReservations();
  renderLoans();
  renderHistory();
}

function setView(name) {
  $$('.view').forEach((view) => {
    const active = view.id === `view-${name}`;
    view.hidden = !active;
    view.classList.toggle('is-visible', active);
  });
  $$('.nav-link').forEach((link) => link.classList.toggle('is-active', link.dataset.view === name));
  $('#breadcrumb-current').textContent = { billetera: 'Billetera', resumen: 'Resumen', reservas: 'Reservas', prestamos: 'Préstamos', movimientos: 'Movimientos' }[name];
}

async function enterApp(user) {
  state.user = user;
  $('#login-screen').hidden = true;
  $('#app-shell').hidden = false;
  try {
    state.users = await api('/api/users');
    populateUserOptions();
    updateIdentity();
    const initialDate = new Date().toISOString().slice(0, 10);
    $('#reservation-date').min = initialDate;
    $('#loan-date').value = initialDate;
    $('#loan-due').value = initialDate;
    await refresh();
    setView('billetera');
  } catch (error) {
    showLogin();
    throw error;
  }
}

function populateUserOptions() {
  const options = state.users.filter((user) => user.rol !== 'admin').map((user) => `<option value="${escapeHtml(user.nombre)}"></option>`).join('');
  $('#reservation-user-list').innerHTML = options;
  $('#loan-user-list').innerHTML = options;
}

function openReservationDialog() {
  const date = new Date().toISOString().slice(0, 10);
  $('#reservation-form').reset();
  $('#reservation-date').value = date;
  $('#reservation-user').value = state.user.rol === 'admin' ? (state.users.find((user) => user.rol !== 'admin')?.nombre || '') : state.user.nombre;
  $('#reservation-user').disabled = state.user.rol !== 'admin';
  setFormError('reservation-error', '');
  $('#reservation-dialog').showModal();
}

function openLoanDialog(reservation = null) {
  const date = new Date().toISOString().slice(0, 10);
  $('#loan-form').reset();
  $('#loan-date').value = date;
  $('#loan-due').value = date;
  state.loanReservation = reservation;
  $('#loan-user').disabled = Boolean(reservation);
  $('#loan-tables').readOnly = Boolean(reservation);
  $('#loan-chairs').readOnly = Boolean(reservation);
  $('#loan-user').value = reservation?.usuarioNombre || state.users.find((user) => user.rol !== 'admin')?.nombre || '';
  $('#loan-tables').value = reservation?.cantidades.mesas || 0;
  $('#loan-chairs').value = reservation?.cantidades.sillas || 0;
  $('#loan-error').hidden = true;
  $('#loan-dialog').showModal();
}

$('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    const { user } = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ correo: form.get('correo'), password: form.get('password') })
    });
    await enterApp(user);
    $('#login-form').reset();
  } catch (error) {
    setFormError('login-error', error.message);
  }
});

$('#logout-button').addEventListener('click', async () => {
  try {
    await api('/api/auth/logout', { method: 'POST', body: '{}' });
    showLogin();
  } catch (error) {
    showToast(error.message, 'error');
  }
});

$$('.nav-link').forEach((button) => button.addEventListener('click', () => setView(button.dataset.view)));
$$('[data-view-link]').forEach((button) => button.addEventListener('click', () => setView(button.dataset.viewLink)));
$$('[data-open-reservation]').forEach((button) => button.addEventListener('click', openReservationDialog));
$$('[data-open-loan]').forEach((button) => button.addEventListener('click', () => openLoanDialog()));
$$('[data-close-dialog]').forEach((button) => button.addEventListener('click', () => button.closest('dialog').close()));

$('#reservation-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    const usuarioNombre = state.user.rol === 'admin' ? String(form.get('usuarioNombre') || '').trim() : state.user.nombre;
    const usuarioId = state.user.rol === 'admin' ? (state.users.find((user) => user.nombre.trim().toLowerCase() === usuarioNombre.toLowerCase())?.id || '') : state.user.id;
    await api('/api/reservations', { method: 'POST', body: JSON.stringify({
      usuarioId,
      usuarioNombre,
      fecha: form.get('fecha'), horaInicio: form.get('horaInicio'), horaFin: form.get('horaFin'),
      cantidades: { mesas: Number(form.get('mesas')), sillas: Number(form.get('sillas')) }
    }) });
    $('#reservation-dialog').close();
    await refresh();
    showToast('Reserva creada. Los recursos quedaron apartados.');
  } catch (error) { setFormError('reservation-error', error.message); }
});

$('#loan-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    const usuarioNombre = String(form.get('usuarioNombre') || '').trim();
    const usuarioId = state.users.find((user) => user.nombre.trim().toLowerCase() === usuarioNombre.toLowerCase())?.id || '';
    const body = {
      usuarioId,
      usuarioNombre,
      fechaPrestamo: form.get('fechaPrestamo'), fechaPrevistaDevolucion: form.get('fechaPrevistaDevolucion'),
      observaciones: form.get('observaciones'), cantidades: { mesas: Number(form.get('mesas')), sillas: Number(form.get('sillas')) }
    };
    const endpoint = state.loanReservation ? `/api/reservations/${state.loanReservation.id}/loan` : '/api/loans';
    await api(endpoint, { method: 'POST', body: JSON.stringify(body) });
    state.loanReservation = null;
    $('#loan-dialog').close();
    await refresh();
    setView('prestamos');
    showToast('Préstamo registrado. Inventario actualizado.');
  } catch (error) { setFormError('loan-error', error.message); }
});

$('#return-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    await api(`/api/loans/${state.returnLoan.id}/returns`, { method: 'POST', body: JSON.stringify({
      observaciones: form.get('observaciones'), cantidades: { mesas: Number(form.get('mesas')), sillas: Number(form.get('sillas')) }
    }) });
    $('#return-dialog').close();
    await refresh();
    showToast('Devolución registrada. La disponibilidad ya refleja el retorno.');
  } catch (error) { setFormError('return-error', error.message); }
});

$('#deposit-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  try {
    await api('/api/wallet/deposits', { method: 'POST', body: JSON.stringify({ importe: form.get('importe') }) });
    formElement.reset();
    await refresh();
    showToast('Saldo ficticio añadido a tu billetera.');
  } catch (error) { setFormError('deposit-error', error.message); }
});

$('#transfer-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  try {
    await api('/api/wallet/transfers', { method: 'POST', body: JSON.stringify({ correo: form.get('correo'), importe: form.get('importe') }) });
    formElement.reset();
    await refresh();
    showToast('Transferencia de demostración completada.');
  } catch (error) { setFormError('transfer-error', error.message); }
});

document.addEventListener('click', async (event) => {
  const action = event.target.closest('[data-action]');
  const returnButton = event.target.closest('[data-return-id]');
  const loanButton = event.target.closest('[data-edit-stock]');
  try {
    if (action) {
      const reservation = state.reservations.find((item) => item.id === action.dataset.id);
      if (action.dataset.action === 'loan') {
        openLoanDialog(reservation);
        return;
      } else {
        if (action.dataset.action === 'cancelar' && !confirm('¿Cancelar esta reserva? Los recursos volverán a estar disponibles.')) return;
        await api(`/api/reservations/${action.dataset.id}`, { method: 'PATCH', body: JSON.stringify({ accion: action.dataset.action }) });
        showToast(action.dataset.action === 'confirmar' ? 'Reserva aprobada.' : 'Reserva cancelada.');
      }
      await refresh();
    }
    if (returnButton) {
      const loan = state.loans.find((item) => item.id === returnButton.dataset.returnId);
      const balance = loanBalance(loan);
      state.returnLoan = loan;
      $('#return-description').textContent = `${loan.usuarioNombre} · ${quantityText(balance)} pendientes`;
      $('#return-tables-pending').textContent = `${balance.mesas || 0} pendientes`;
      $('#return-chairs-pending').textContent = `${balance.sillas || 0} pendientes`;
      $('#return-tables').max = balance.mesas || 0;
      $('#return-chairs').max = balance.sillas || 0;
      $('#return-form').reset();
      $('#return-error').hidden = true;
      $('#return-dialog').showModal();
    }
    if (loanButton) {
      const resource = state.inventory.find((item) => item.id === loanButton.dataset.editStock);
      const total = prompt(`Nuevo total de ${resource.nombre.toLowerCase()}:`, String(resource.total));
      if (total === null) return;
      await api(`/api/inventory/${resource.id}`, { method: 'PATCH', body: JSON.stringify({ total: Number(total) }) });
      await refresh();
      showToast('Inventario actualizado.');
    }
  } catch (error) { showToast(error.message, 'error'); }
});

async function start() {
  try {
    const { user } = await api('/api/auth/session');
    if (user) await enterApp(user);
  } catch (error) {
    setFormError('login-error', error.message);
  }
}

start();