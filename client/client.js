// client/client.js
// Lógica cliente para Tilt Zero: login simulado, envío de apuestas y actualización del DOM

const socket = io();

let currentUser = null; // { id, username, fichas, elo }

const usernameEl = document.getElementById('username');
const fichasEl = document.getElementById('fichas');
const eloEl = document.getElementById('elo');
const diceEl = document.getElementById('diceResult');
const messagesEl = document.getElementById('messages');
const betAmountInput = document.getElementById('betAmount');
const betDisplayEl = document.getElementById('betDisplay');
const betSolesEl = document.getElementById('betSoles');
const chipButtons = document.getElementsByClassName('chip');
const clearChipsBtn = document.getElementById('clearChips');
const betRedBtn = document.getElementById('betRed');
const betBlueBtn = document.getElementById('betBlue');
const leaderListEl = document.getElementById('leaderList');
const roundTimerEl = document.getElementById('roundTimer');
const vsRedEl = document.getElementById('vsRed');
const vsBlueEl = document.getElementById('vsBlue');
const vsPercentEl = document.getElementById('vsPercent');
const vsPotEl = document.getElementById('vsPot');
const redTotalEl = document.getElementById('redTotal');
const blueTotalEl = document.getElementById('blueTotal');
const redCountEl = document.getElementById('redCount');
const blueCountEl = document.getElementById('blueCount');
const userBetEl = document.getElementById('userBet');
// floating loan UI elements (fixed bottom viewport)
const loanFloating = document.getElementById('loanFloating');
const loanBtnFloating = document.getElementById('loanBtnFloating');
const loanCloseFloating = document.getElementById('loanCloseFloating');
const loanFloatingImg = document.getElementById('loanFloatingImg');
const loginOverlay = document.getElementById('loginOverlay');
const loginNameInput = document.getElementById('loginName');
const loginBtn = document.getElementById('loginBtn');
// comprobar nombre almacenado en localStorage
const STORAGE_KEY = 'tiltzero_username';
const storedName = (typeof window !== 'undefined' && window.localStorage) ? window.localStorage.getItem(STORAGE_KEY) : null;
if (storedName && loginNameInput) {
  loginNameInput.value = storedName;
}

let currentRoundId = null;
let roundOpen = false;
let roundDuration = 0;
let roundEndsAt = 0;
let nextStartsAt = 0;

function log(msg) {
  const time = new Date().toLocaleTimeString();
  messagesEl.textContent = `[${time}] ${msg}\n` + messagesEl.textContent;
}

// Ocultar el elemento del dado en la UI: no mostramos el número del dado al usuario
if (diceEl) {
  try { diceEl.style.display = 'none'; } catch (e) {}
}

// Handler de login desde la UI
function doLogin() {
  const name = (loginNameInput && loginNameInput.value) ? String(loginNameInput.value).trim() : '';
  if (!name) {
    alert('Introduce un nombre de usuario válido');
    return;
  }
  // Desactivar mientras esperamos respuesta
  if (loginBtn) loginBtn.disabled = true;
  if (loginNameInput) loginNameInput.disabled = true;
  // guardar en localStorage para futuras visitas
  try { if (window && window.localStorage) window.localStorage.setItem(STORAGE_KEY, name); } catch (e) {}
  requestLogin(name);
}

if (loginBtn) loginBtn.addEventListener('click', doLogin);
if (loginNameInput) loginNameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });

// Solicitar login simulado al servidor
function requestLogin(username) {
  socket.emit('requestLogin', { username });
}

// Manejar userData
socket.on('userData', (data) => {
  currentUser = data;
  usernameEl.textContent = data.username;
  fichasEl.textContent = data.fichas;
  eloEl.textContent = data.elo;
  log(`Conectado como ${data.username} (id=${data.id})`);
  // ocultar overlay de login
  try { if (loginOverlay) loginOverlay.style.display = 'none'; } catch (e) {}
  try { checkLoanVisibility(); updateChipButtons(); } catch (e) {}
});

// Manejo de chips: al hacer click en una ficha, se suma al monto seleccionado
function updateBetDisplay() {
  // leer valor de input de forma segura
  let val = 0;
  try { val = parseInt(betAmountInput.value, 10); } catch (e) { val = 0; }
  if (!Number.isFinite(val) || Number.isNaN(val)) val = 0;
  // clamp al máximo disponible para evitar mostrar montos mayores al saldo
  const available = Number(getAvailableFichas() || 0);
  const clamped = Math.max(0, Math.min(val, Number.isFinite(available) ? available : 0));
  // diagnóstico: registrar valores que afectan al Monto para depurar casos stales
  try { console.debug('[client] updateBetDisplay', { inputVal: val, available, clamped, currentUserFichas: currentUser ? currentUser.fichas : null, fichasElText: fichasEl ? fichasEl.textContent : null }); } catch (e) {}
  if (clamped !== val) {
    betAmountInput.value = clamped;
  }
  if (betDisplayEl) betDisplayEl.textContent = String(clamped || 0);
  try {
    if (betSolesEl) {
      // mostrar S/ del monto total (regla: S/(betAmount*2) usada antes)
      const soles = (Number.isFinite(clamped) ? (clamped * 2) : 0);
      betSolesEl.textContent = `(S/${soles})`;
    }
  } catch (e) {}
  // actualizar estado de botones de fichas según el saldo restante
  updateChipButtons();
}

// Asegurar que al teclear manualmente se actualice en vivo
try {
  if (betAmountInput) betAmountInput.addEventListener('input', updateBetDisplay);
} catch (e) {}

function getAvailableFichas() {
  try {
    const raw = currentUser ? currentUser.fichas : (fichasEl ? fichasEl.textContent : 0);
    const currentF = Number(raw);
    if (!Number.isFinite(currentF) || Number.isNaN(currentF)) return 0;
    return Math.max(0, Math.floor(currentF));
  } catch (e) { return 0; }
}

function updateChipButtons() {
  const chips = Array.from(document.getElementsByClassName('chip') || []);
  const currentBet = Number(betAmountInput.value) || 0;
  const available = getAvailableFichas();
  const remaining = Math.max(0, available - currentBet);
  chips.forEach((btn) => {
    const v = Number(btn.getAttribute('data-value') || 0);
    if (v > remaining) {
      btn.classList.add('disabled');
      btn.disabled = true;
    } else {
      btn.classList.remove('disabled');
      btn.disabled = false;
    }
  });
  // también deshabilitar los botones de apostar si el monto seleccionado excede el saldo o es 0
  const betAmt = Number(betAmountInput.value) || 0;
  const canBet = betAmt > 0 && betAmt <= available && roundOpen;
  try { if (betRedBtn) betRedBtn.disabled = !canBet; } catch (e) {}
  try { if (betBlueBtn) betBlueBtn.disabled = !canBet; } catch (e) {}
}

// Mostrar/ocultar botón de préstamo según fichas actuales y monto seleccionado
function checkLoanVisibility() {
  try {
    // Preferir la bandera explícita que envía el servidor (loanAvailable)
    const explicit = currentUser && typeof currentUser.loanAvailable !== 'undefined' ? Boolean(currentUser.loanAvailable) : null;
    if (explicit !== null) {
      if (explicit) { if (loanFloating) loanFloating.classList.add('show'); }
      else { if (loanFloating) loanFloating.classList.remove('show'); }
      return;
    }
    // Fallback: mostrar si el jugador tiene menos de 5 fichas y no hay apuesta en curso
    const currentF = currentUser ? Number(currentUser.fichas || 0) : Number(fichasEl.textContent || 0);
    const threshold = 5; // mostrar si el jugador tiene menos de 5 fichas
    if (currentF < threshold) {
      if (loanFloating) loanFloating.classList.add('show');
    } else {
      if (loanFloating) loanFloating.classList.remove('show');
    }
  } catch (e) {}
}

// sidebar loan button removed; floating UI handles requests now

// handlers para el botón flotante y cerrar flotante
if (loanBtnFloating) {
  loanBtnFloating.addEventListener('click', () => {
    if (!confirm('¿Pedir prestado a Peter? Te dará +2000 fichas.')) return;
    try { loanBtnFloating.disabled = true; } catch (e) {}
    // enviar el umbral de 5 fichas para que el servidor sepa la condición que queremos
    socket.emit('requestLoan', { needed: 5 });
  });
}

if (loanCloseFloating) {
  loanCloseFloating.addEventListener('click', () => {
    try { if (loanFloating) loanFloating.classList.remove('show'); } catch (e) {}
  });
}

Array.from(chipButtons || []).forEach((btn) => {
  btn.addEventListener('click', (e) => {
    const v = Number(btn.getAttribute('data-value') || 0);
    const current = Number(betAmountInput.value) || 0;
    // animate chip flying to pile/center
    animateChipToTarget(btn, document.getElementById('chipPile'));
    betAmountInput.value = current + v;
    updateBetDisplay();
  });
});

if (clearChipsBtn) clearChipsBtn.addEventListener('click', () => {
  betAmountInput.value = 0;
  updateBetDisplay();
});

// Inicializar display
updateBetDisplay();

socket.on('betResult', (res) => {
  try { console.debug('[client] betResult received', res, { currentUserId: currentUser? currentUser.id : null, betAmountInput: betAmountInput? betAmountInput.value : null }); } catch (e) {}
  if (res.error) {
    log('Error: ' + res.error);
    return;
  }
  // animar cambio de fichas para el usuario correspondiente
  try {
    if (currentUser && res.userId === currentUser.id) {
      const oldF = Number(fichasEl.textContent) || 0;
      const newF = Number(res.newFichas) || 0;
      // actualizar el objeto currentUser inmediatamente para que los botones se recalculen correctamente
      try { if (currentUser) currentUser.fichas = newF; } catch (e) {}
      animateFichasChange(oldF, newF);
      // mostrar burst win/lose
      animateResultForUser(res.change > 0 ? 'win' : 'lose');
      // limpiar la apuesta activa y recalcular el display inmediatamente
      try { if (betAmountInput) betAmountInput.value = 0; } catch (e) {}
      try { updateBetDisplay(); } catch (e) {}
    } else {
      // actualización para otros jugadores: actualizar directamente
      fichasEl.textContent = res.newFichas;
    }
    eloEl.textContent = res.newElo;
    try { console.debug('[client] after betResult update', { currentUserFichas: currentUser? currentUser.fichas : null, fichasElText: fichasEl ? fichasEl.textContent : null, betAmountInput: betAmountInput? betAmountInput.value : null }); } catch (e) {}
    // fuerza una re-evaluación corta después de las animaciones para evitar condiciones de carrera
    setTimeout(() => { try { updateBetDisplay(); } catch (e) {} }, 350);
  } catch (e) {
    // fallback
    fichasEl.textContent = res.newFichas;
    eloEl.textContent = res.newElo;
  }
  const msg = `Apuesta ${res.betAmount} ${res.betTarget} -> ${res.outcome.toUpperCase()} (cambio ${res.change >=0? '+' : ''}${res.change})`;
  log(msg);
  // Si corresponde a la apuesta del usuario, mostrar resultado personal y limpiar después
  if (currentUser && res.userId === currentUser.id) {
    if (userBetEl) userBetEl.textContent = `Has apostado ${res.betAmount} a ${res.betTarget.toUpperCase()} — Resultado: ${res.outcome.toUpperCase()} (${res.change >=0? '+' : ''}${res.change})`;
    setTimeout(() => { if (userBetEl) userBetEl.textContent = ''; }, 5000);
    try { checkLoanVisibility(); } catch (e) {}
    try { updateChipButtons(); } catch (e) {}
  }
});

socket.on('playerUpdate', (p) => {
  try { console.debug('[client] playerUpdate received', p, { currentUserId: currentUser? currentUser.id : null, betAmountInput: betAmountInput? betAmountInput.value : null }); } catch (e) {}
  // si la actualización corresponde al usuario actual, actualizar su estado
  // Actualizar entrada del leaderboard si corresponde
  try {
    // refrescar fichas/elo si es el usuario actual
    if (currentUser && p.id === currentUser.id) {
      currentUser.fichas = p.fichas;
      currentUser.elo = p.elo;
      // aplicar bandera explícita de loanAvailable enviada por el servidor (si existe)
      if (typeof p.loanAvailable !== 'undefined') {
        try { currentUser.loanAvailable = Boolean(p.loanAvailable); } catch (e) {}
      }
      // animar el cambio en pantalla
      const old = Number(fichasEl.textContent) || 0;
      animateFichasChange(old, Number(p.fichas || 0));
      eloEl.textContent = p.elo;
      try { checkLoanVisibility(); } catch (e) {}
      updateChipButtons();
      try { console.debug('[client] playerUpdate applied', { currentUserFichas: currentUser? currentUser.fichas : null, fichasElText: fichasEl ? fichasEl.textContent : null, betAmountInput: betAmountInput? betAmountInput.value : null }); } catch (e) {}
    }
    // también actualizar la lista de leaderboard si existe (re-render completo será enviado por server)
    // si el cliente recibió 'leaderboard' después de esto, será actualizado por su handler.
  } catch (e) {
    // fallback simple
    try { if (currentUser && p.id === currentUser.id) { fichasEl.textContent = p.fichas; eloEl.textContent = p.elo; } } catch (err) {}
  }
});

socket.on('leaderboard', (list) => {
  // list = [{id, username, fichas, elo_score}, ...]
  leaderListEl.innerHTML = '';
  (list || []).forEach((row) => {
    const li = document.createElement('li');
    li.textContent = `${row.username} — ELO: ${row.elo_score} — Fichas: ${row.fichas}`;
    leaderListEl.appendChild(li);
  });
});

socket.on('loanResult', (res) => {
  if (!res) return;
  if (res.error) {
    log('Loan error: ' + res.error);
    try { if (loanBtnFloating) loanBtnFloating.disabled = false; } catch (e) {}
    return;
  }
  // éxito
  log(`Peter te prestó +${res.grant} fichas`);
  try {
    const oldF = Number(fichasEl.textContent) || 0;
    const newF = Number(res.newFichas) || (oldF + (res.grant || 2000));
    animateFichasChange(oldF, newF);
    if (currentUser) currentUser.fichas = newF;
    fichasEl.textContent = newF;
    try { if (loanBtnFloating) loanBtnFloating.disabled = false; } catch (e) {}
    // marcar que ya no está disponible el préstamo para este usuario y cerrar el modal en vivo
    try { if (currentUser) currentUser.loanAvailable = false; } catch (e) {}
    try { if (loanFloating) loanFloating.classList.remove('show'); } catch (e) {}
    checkLoanVisibility();
    try { updateChipButtons(); } catch (e) {}
  } catch (e) {
    try { fichasEl.textContent = res.newFichas; } catch (err) {}
  }
});

// Rondas en tiempo real
socket.on('roundStart', (data) => {
  // data: { id, duration }
  currentRoundId = data.id;
  roundOpen = true;
  roundDuration = Number(data.duration) || 0;
  roundEndsAt = Date.now() + (roundDuration || 0);
  roundTimerEl.textContent = Math.ceil((roundEndsAt - Date.now()) / 1000) + 's';
  updateProgress();
  betRedBtn.disabled = false;
  betBlueBtn.disabled = false;
  log('Ronda abierta: ' + data.id);
  // limpiar apuesta visual del usuario al iniciar la ronda
  if (userBetEl) userBetEl.textContent = '';
});

socket.on('roundTick', (t) => {
  if (t && t.remaining != null) {
    roundTimerEl.textContent = Math.ceil(t.remaining / 1000) + 's';
    // actualizar fin aproximado
    if (t.duration) {
      roundDuration = Number(t.duration);
    }
    roundEndsAt = Date.now() + Number(t.remaining);
    updateProgress();
  }
});

socket.on('roundNext', (data) => {
  // data: { startsIn }
  nextStartsAt = Date.now() + Number(data.startsIn || 0);
  roundTimerEl.textContent = Math.ceil((nextStartsAt - Date.now()) / 1000) + 's';
  log('Próxima ronda en corta espera...');
});

socket.on('roundNextTick', (t) => {
  if (t && t.remaining != null) {
    roundTimerEl.textContent = 'Comienza en ' + Math.ceil(t.remaining / 1000) + 's';
    // reset progress while waiting
    const bar = document.getElementById('roundProgress');
    if (bar) bar.style.width = '0%';
  }
});

// Estadísticas compartidas de la ronda (distribución de apuestas)
socket.on('roundStats', (stats) => {
  if (!stats) return;
  const total = Number(stats.totalPot || 0);
  const red = Number(stats.redTotal || 0);
  const blue = Number(stats.blueTotal || 0);
  const redCount = Number(stats.redCount || 0);
  const blueCount = Number(stats.blueCount || 0);

  let redPct = 50, bluePct = 50;
  if (total > 0) {
    redPct = Math.round((red / total) * 100);
    bluePct = 100 - redPct;
  }

  if (vsRedEl) vsRedEl.style.width = redPct + '%';
  if (vsBlueEl) vsBlueEl.style.width = bluePct + '%';
  if (vsPercentEl) vsPercentEl.textContent = `${redPct}% / ${bluePct}%`;
  if (vsPotEl) vsPotEl.textContent = `Pot: ${total}`;
  if (redTotalEl) redTotalEl.textContent = red;
  if (blueTotalEl) blueTotalEl.textContent = blue;
  if (redCountEl) redCountEl.textContent = redCount;
  if (blueCountEl) blueCountEl.textContent = blueCount;
});

socket.on('roundEnd', (data) => {
  roundOpen = false;
  roundTimerEl.textContent = '-';
  betRedBtn.disabled = true;
  betBlueBtn.disabled = true;
  log('Ronda cerrada: ' + data.id);
  // completar barra
  const bar = document.getElementById('roundProgress');
  if (bar) bar.style.width = '100%';
  // mientras llegan los resultados mostramos un texto indicativo; será reemplazado por roundSummary
  const pct = document.getElementById('vsPercent');
  if (pct) pct.textContent = 'Calculando...';
});

socket.on('roundState', (s) => {
  // Estado inicial al conectar: puede contener id, isOpen, remaining, duration
  if (!s) return;
  currentRoundId = s.id || null;
  roundOpen = !!s.isOpen;
  roundDuration = Number(s.duration) || 0;
  roundEndsAt = Date.now() + (Number(s.remaining) || 0);
  if (roundOpen) {
    betRedBtn.disabled = false;
    betBlueBtn.disabled = false;
    roundTimerEl.textContent = Math.ceil((roundEndsAt - Date.now()) / 1000) + 's';
    updateProgress();
    log('Ronda en curso al conectar: ' + currentRoundId);
  } else {
    betRedBtn.disabled = true;
    betBlueBtn.disabled = true;
    roundTimerEl.textContent = '-';
  }
});

socket.on('betAccepted', (info) => {
  if (info && info.message) log(info.message + (info.roundId ? ` (round ${info.roundId})` : ''));
  if (info && info.betAmount && info.betTarget) {
    if (userBetEl) userBetEl.textContent = `Has apostado ${info.betAmount} a ${info.betTarget.toUpperCase()}`;
    try { updateChipButtons(); } catch (e) {}
  }
});

socket.on('roundSummary', (summary) => {
  try { console.debug('[client] roundSummary received', summary, { betAmountInput: betAmountInput? betAmountInput.value : null, currentUserFichas: currentUser? currentUser.fichas : null }); } catch (e) {}
  if (!summary) return;
  // No mostramos el dado al usuario (diseño solicitado). Mostrar el lado ganador en el centro.
  const winner = summary.winner;
  log(`Ronda ${summary.roundId} finalizada — Ganador: ${String(winner).toUpperCase()}`);
  // actualizar texto central para que muestre ROJO / AZUL en lugar de "Esperando resultado..."
  if (vsPercentEl) {
    if (winner === 'red') vsPercentEl.textContent = 'ROJO';
    else if (winner === 'blue') vsPercentEl.textContent = 'AZUL';
    else vsPercentEl.textContent = 'EMPATE';
  }
  // mostrar resultado final (resaltar lado ganador)
  if (winner === 'red') {
    if (vsRedEl) vsRedEl.style.boxShadow = '0 6px 18px rgba(231,76,60,0.25)';
    if (vsBlueEl) vsBlueEl.style.boxShadow = 'none';
  } else if (winner === 'blue') {
    if (vsBlueEl) vsBlueEl.style.boxShadow = '0 6px 18px rgba(52,152,219,0.25)';
    if (vsRedEl) vsRedEl.style.boxShadow = 'none';
  } else {
    if (vsRedEl) vsRedEl.style.boxShadow = '0 6px 18px rgba(0,0,0,0.06)';
    if (vsBlueEl) vsBlueEl.style.boxShadow = '0 6px 18px rgba(0,0,0,0.06)';
  }
  // limpiar apuesta del usuario pasada la visualizacion
  setTimeout(() => { if (userBetEl) userBetEl.textContent = ''; }, 5000);
  // al finalizar la ronda limpiamos el input de apuesta y recalculamos montos para evitar mostrar la apuesta anterior
  try { if (betAmountInput) betAmountInput.value = 0; } catch (e) {}
  try { updateBetDisplay(); } catch (e) {}
});

function updateProgress() {
  const bar = document.getElementById('roundProgress');
  if (!bar) return;
  if (!roundDuration || !roundEndsAt) {
    bar.style.width = '0%';
    return;
  }
  const remaining = Math.max(0, roundEndsAt - Date.now());
  const elapsed = Math.max(0, roundDuration - remaining);
  const pct = Math.min(100, Math.round((elapsed / roundDuration) * 100));
  bar.style.width = pct + '%';
}

// --- Animations: fly chip from source to target ---
function animateChipToTarget(sourceBtn, targetEl) {
  try {
    const rectSrc = sourceBtn.getBoundingClientRect();
    const rectT = targetEl.getBoundingClientRect();
    const clone = sourceBtn.cloneNode(true);
    clone.classList.add('fly-chip');
    // inline styles to position
    clone.style.left = rectSrc.left + 'px';
    clone.style.top = rectSrc.top + 'px';
    clone.style.width = rectSrc.width + 'px';
    clone.style.height = rectSrc.height + 'px';
    clone.style.background = window.getComputedStyle(sourceBtn).background;
    clone.style.color = window.getComputedStyle(sourceBtn).color;
    document.body.appendChild(clone);

    // compute translation
    const targetX = rectT.left + rectT.width / 2 - rectSrc.width / 2;
    const targetY = rectT.top + rectT.height / 2 - rectSrc.height / 2;
    const dx = targetX - rectSrc.left;
    const dy = targetY - rectSrc.top;
    requestAnimationFrame(() => {
      clone.style.transition = 'transform 700ms cubic-bezier(.2,.9,.2,1), opacity 500ms';
      clone.style.transform = `translate(${dx}px, ${dy}px) scale(0.6)`;
      clone.style.opacity = '0';
    });
    setTimeout(() => { if (clone && clone.parentNode) clone.parentNode.removeChild(clone); }, 800);
  } catch (e) {
    // ignore animation errors
  }
}

// Animate result for user: upward if win, downward if lose
function animateResultForUser(outcome) {
  const pile = document.getElementById('chipPile');
  if (!pile) return;
  const chip = document.createElement('div');
  chip.className = 'chip';
  chip.textContent = 'x';
  chip.style.position = 'absolute';
  chip.style.left = '50%';
  chip.style.transform = 'translateX(-50%)';
  pile.appendChild(chip);
  if (outcome === 'win') {
    chip.classList.add('burst-win');
  } else {
    chip.classList.add('burst-lose');
  }
  setTimeout(() => { try { if (chip && chip.parentNode) chip.parentNode.removeChild(chip); } catch(e){} }, 1000);
}

// Animación suave para cambiar el número de fichas en pantalla
function animateFichasChange(from, to) {
  try {
    // actualizar el valor canónico inmediatamente para que la lógica que consulta
    // currentUser.fichas no vea valores intermedios y cause un Monto "stale".
    try { if (currentUser) currentUser.fichas = to; } catch (e) {}
    const duration = 700; // ms
    const start = performance.now();
    const diff = to - from;
    function step(now) {
      const t = Math.min(1, (now - start) / duration);
      const eased = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; // easeInOutQuad-ish
      const val = Math.round(from + diff * eased);
      fichasEl.textContent = String(val);
      if (t < 1) requestAnimationFrame(step);
      else {
        // asegurar el valor final
        fichasEl.textContent = String(to);
        // currentUser.fichas ya fue actualizado arriba; asegurar valor final en DOM
      }
    }
    requestAnimationFrame(step);
  } catch (e) {
    // fallback inmediato
    try { fichasEl.textContent = String(to); if (currentUser) currentUser.fichas = to; } catch (err) {}
  }
}

socket.on('connect', () => {
  log('Socket conectado: ' + socket.id);
  // Esperar a que el usuario introduzca su nombre en el overlay antes de hacer login
  try { if (loginOverlay) loginOverlay.style.display = 'flex'; } catch (e) {}
  // Si ya hay un nombre almacenado, iniciar login automáticamente
  try {
    if (storedName) {
      // desactivar input visualmente
      if (loginNameInput) loginNameInput.disabled = true;
      if (loginBtn) loginBtn.disabled = true;
      requestLogin(storedName);
    }
  } catch (e) {}
});

socket.on('error', (e) => log('Error socket: ' + (e && e.message)));

function placeBet(target) {
  if (!currentUser) {
    log('No autenticado aún');
    return;
  }
  const betAmount = Number(betAmountInput.value);
  if (!Number.isInteger(betAmount) || betAmount <= 0) {
    log('Monto inválido');
    return;
  }
  if (!roundOpen || !currentRoundId) {
    log('No hay ronda abierta para apostar');
    return;
  }
  // Prevención en cliente: deshabilitar botones para evitar envíos duplicados rápidos
  try { if (betRedBtn) betRedBtn.disabled = true; } catch (e) {}
  try { if (betBlueBtn) betBlueBtn.disabled = true; } catch (e) {}
  console.log('[client] placeBet ->', { userId: currentUser && currentUser.id, betAmount, betTarget: target, roundId: currentRoundId });
  socket.emit('placeBet', { userId: currentUser.id, betAmount, betTarget: target, roundId: currentRoundId });
  // Safety: si no llega respuesta en 1.5s, re-habilitar botones para que el usuario no quede bloqueado
  setTimeout(() => {
    try {
      // solo re-habilitar si la condición actual permite apostar (se recalculará en updateChipButtons())
      updateChipButtons();
      console.log('[client] placeBet timeout: re-evaluated buttons');
    } catch (e) { console.warn('[client] placeBet timeout error', e); }
  }, 1500);
}

betRedBtn.addEventListener('click', () => placeBet('red'));
betBlueBtn.addEventListener('click', () => placeBet('blue'));
