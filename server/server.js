// server/server.js
// Controlador principal: Express + Socket.io para Tilt Zero

const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const db = require('./db');
const game = require('./gameLogic');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Servir archivos estáticos del cliente
app.use(express.static(path.join(__dirname, '..', 'client')));
// Servir recursos adicionales (p. ej. GIFs) desde la raíz del proyecto en /assets
app.use('/assets', express.static(path.join(__dirname, '..')));

// Endpoint simple
app.get('/api/status', (req, res) => res.json({ ok: true, now: Date.now() }));

// Endpoint de depuración: iniciar una ronda inmediata (solo para testing local)
app.post('/api/debug/start-round', (req, res) => {
  try {
    if (globalThis.currentRound && globalThis.currentRound.isOpen) {
      return res.status(409).json({ error: 'Ya hay una ronda abierta' });
    }
    // arrancar una ronda inmediata en background (no bloquear)
    (async () => {
      try {
        console.log('Debug: iniciando ronda inmediata (trigger)');
        const roundId = `debug_${Date.now()}`;
        globalThis.currentRound = { id: roundId, isOpen: true, bets: [], startedAt: Date.now(), endsAt: Date.now() + BET_WINDOW_MS, stats: { redCount:0, blueCount:0, redTotal:0, blueTotal:0, totalPot:0 } };
        io.emit('roundStart', { id: roundId, duration: BET_WINDOW_MS });

        const tickInterval = setInterval(() => {
          const remaining = Math.max(0, globalThis.currentRound.endsAt - Date.now());
          const duration = Math.max(0, (globalThis.currentRound.endsAt - globalThis.currentRound.startedAt) || 0);
          io.emit('roundTick', { id: roundId, remaining, duration });
          io.emit('roundStats', globalThis.currentRound.stats);
        }, 1000);

        await new Promise((r) => setTimeout(r, BET_WINDOW_MS));
        globalThis.currentRound.isOpen = false;
        clearInterval(tickInterval);
        io.emit('roundEnd', { id: roundId });

        // procesar apuestas usando UN solo RNG por ronda
        const betsToProcess = globalThis.currentRound.bets.slice();
        const dice = game.rollDice();
        for (const b of betsToProcess) {
          try {
            // si la apuesta fue reservada al aceptar, indicarlo para que el procesamiento ajuste correctamente
            const opts = { alreadyReserved: !!b.reserved };
            const result = await game.processBet(b.userId, b.betAmount, b.betTarget, dice, opts);
            const targetSocket = io.sockets.sockets.get(b.socketId);
            if (targetSocket && targetSocket.connected) targetSocket.emit('betResult', result);
            // Emitir actualización del jugador para que todas las vistas se sincronicen automáticamente
            try { io.emit('playerUpdate', { id: result.userId, fichas: result.newFichas, elo: result.newElo }); } catch (e) { console.error('Error emitting playerUpdate:', e); }
          } catch (e) {
            const targetSocket = io.sockets.sockets.get(b.socketId);
            if (targetSocket && targetSocket.connected) targetSocket.emit('betResult', { error: e.message });
          }
        }

        // determinar ganador global según el dado (no según las sumas de apuestas)
        const stats = globalThis.currentRound.stats || {};
        let winner = 'tie';
        if (Number.isInteger(dice)) {
          if (dice >= 1 && dice <= 3) winner = 'red';
          else if (dice >= 4 && dice <= 6) winner = 'blue';
        } else {
          // fallback por si no hay dado: usar totals
          if ((stats.redTotal||0) > (stats.blueTotal||0)) winner = 'red';
          if ((stats.blueTotal||0) > (stats.redTotal||0)) winner = 'blue';
        }
        io.emit('roundSummary', { roundId, stats, winner, dice });
        const top = await db.getTopUsers(10);
        io.emit('leaderboard', top);
      } catch (e) {
        console.error('Error en debug round:', e);
      }
    })();

    return res.json({ ok: true, message: 'Ronda debug iniciada' });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

// Inicializar BD
(async () => {
  try {
    await db.initDB();
    console.log('DB inicializada');
  } catch (err) {
    console.error('Error iniciando DB:', err);
  }
})();

io.on('connection', (socket) => {
  console.log('Socket conectado:', socket.id);

  // asegurar contador de handlers en vuelo para sincronizar cierre de ronda
  if (typeof globalThis.pendingPlaceBetCount === 'undefined') globalThis.pendingPlaceBetCount = 0;

  // Al conectar, enviar leaderboard actual
  (async () => {
    try {
      const top = await db.getTopUsers(10);
      socket.emit('leaderboard', top);
      // También enviar estado actual de la ronda al socket que se conecta
      if (globalThis.currentRound) {
        const remaining = Math.max(0, globalThis.currentRound.endsAt - Date.now());
        const duration = Math.max(0, (globalThis.currentRound.endsAt - globalThis.currentRound.startedAt) || 0);
        socket.emit('roundState', { id: globalThis.currentRound.id, isOpen: !!globalThis.currentRound.isOpen, remaining, duration });
        if (globalThis.currentRound.stats) socket.emit('roundStats', globalThis.currentRound.stats);
      }
    } catch (e) {
      // no bloquear si falla
    }
  })();

  // requestLogin: payload { username }
  socket.on('requestLogin', async (payload) => {
    try {
      const username = payload && payload.username ? String(payload.username) : `guest_${socket.id.slice(0,6)}`;
      let user = await db.getUser(username);
      if (!user) {
        user = await db.createNewUser(username);
      }

      // Asociar el userId al socket en el servidor para evitar que el cliente suplante identities
      socket.data.userId = user.id;

      // Emitir userData con fichas y elo
      try {
        const reserved = Number(globalThis.reservedByUser[user.id] || 0);
        const loanAvailable = (Number(user.fichas || 0) < 5 && reserved === 0);
        socket.emit('userData', { id: user.id, username: user.username, fichas: user.fichas, elo: user.elo_score, loanAvailable });
      } catch (e) {
        socket.emit('userData', { id: user.id, username: user.username, fichas: user.fichas, elo: user.elo_score });
      }
    } catch (err) {
      socket.emit('error', { message: err.message });
    }
  });

  // placeBet: { userId, betAmount, betTarget }
  // placeBet: ahora aceptamos apuestas sólo si pertenecen a la ronda activa y dentro de la ventana
  socket.on('placeBet', async (payload) => {
    // marcar entrada de handler en vuelo
    globalThis.pendingPlaceBetCount = (globalThis.pendingPlaceBetCount || 0) + 1;
    try {
      console.log('placeBet received from socket', socket.id, 'payload=', payload, 'socket.data.userId=', socket.data && socket.data.userId, 'pendingCount=', globalThis.pendingPlaceBetCount);
      // payload: { userId, betAmount, betTarget, roundId }
      const now = Date.now();
      if (!globalThis.currentRound || !globalThis.currentRound.isOpen) {
        console.log('placeBet rejected: no currentRound open');
        return socket.emit('betResult', { error: 'No hay ronda abierta. Espera al siguiente round.' });
      }
      if (payload.roundId !== globalThis.currentRound.id) {
        console.log('placeBet rejected: roundId mismatch', payload.roundId, 'expected', globalThis.currentRound.id);
        return socket.emit('betResult', { error: 'Ronda inválida o desactualizada.' });
      }

      // usar userId asociado al socket (server-side) para evitar suplantación
      const userId = socket.data && socket.data.userId ? socket.data.userId : null;
      if (!userId) return socket.emit('betResult', { error: 'No autenticado. Haz login antes de apostar.' });

  // añadir a la cola de apuestas para procesar al cierre de la ronda
  const amount = Math.floor(Number(payload.betAmount) || 0);
      const target = String(payload.betTarget || '').toLowerCase();
      // validar target
      if (!['red', 'blue'].includes(target)) return socket.emit('betResult', { error: 'betTarget inválido' });

  // validar monto y saldo del usuario en el servidor (autoridad)
  if (!Number.isInteger(amount) || amount <= 0) return socket.emit('betResult', { error: 'Monto inválido' });

      const userIdServer = socket.data && socket.data.userId ? socket.data.userId : null;
      if (!userIdServer) {
        console.log('placeBet rejected: socket has no associated userId', socket.id);
        return socket.emit('betResult', { error: 'No autenticado. Haz login antes de apostar.' });
      }
      const user = await db.getUser(userIdServer);
      if (!user) {
        console.log('placeBet rejected: user not found for id', userIdServer);
        return socket.emit('betResult', { error: 'Usuario no encontrado' });
      }

  // Para evitar duplicados y over-commit, intentar reservar de forma atómica en la BD
      const reservedUser = await db.tryReserveFichas(user.id, amount);
      if (!reservedUser) {
        console.log('placeBet reservation failed for user', user.id, 'amount', amount);
        return socket.emit('betResult', { error: 'Fichas insuficientes o reservadas por otra operación' });
      }
  console.log('placeBet reserved OK for user', user.id, 'newFichas=', reservedUser.fichas);
  // marcar reservado por usuario
  try { globalThis.reservedByUser[user.id] = (globalThis.reservedByUser[user.id] || 0) + amount; } catch (e) {}
  // Emitir actualización inmediata para que clientes vean el saldo descontado. No permitir préstamo mientras haya reserva en curso
  // Enviar tanto al usuario que hizo la apuesta como a todos (broadcast) para máxima sincronía
  try {
    socket.emit('playerUpdate', { id: reservedUser.id, fichas: reservedUser.fichas, elo: reservedUser.elo_score, loanAvailable: false });
  } catch (e) {}
  try { io.emit('playerUpdate', { id: reservedUser.id, fichas: reservedUser.fichas, elo: reservedUser.elo_score, loanAvailable: false }); } catch (e) {}

  // marcar que la apuesta fue reservada al aceptarla
  globalThis.currentRound.bets.push({ socketId: socket.id, userId: userId, betAmount: amount, betTarget: target, reserved: true });
  console.log('placeBet queued', { socketId: socket.id, userId: userId, amount, target, roundId: payload.roundId });
      // actualizar estadísticas agregadas
      if (target === 'red') {
        globalThis.currentRound.stats.redCount += 1;
        globalThis.currentRound.stats.redTotal += amount;
      } else {
        globalThis.currentRound.stats.blueCount += 1;
        globalThis.currentRound.stats.blueTotal += amount;
      }
      globalThis.currentRound.stats.totalPot = globalThis.currentRound.stats.redTotal + globalThis.currentRound.stats.blueTotal;

  socket.emit('betAccepted', { message: 'Apuesta recibida para la ronda', roundId: payload.roundId, betAmount: amount, betTarget: target });
      // emitir stats actualizados a todos los clientes
      io.emit('roundStats', globalThis.currentRound.stats);
    } catch (err) {
      socket.emit('betResult', { error: err.message });
    } finally {
      // marcar salida del handler
      globalThis.pendingPlaceBetCount = Math.max(0, (globalThis.pendingPlaceBetCount || 1) - 1);
      console.log('placeBet handler finished for socket', socket.id, 'pendingCount=', globalThis.pendingPlaceBetCount);
    }
  });

  // requestLoan: el jugador puede pedir prestado a 'Peter' para recibir 2000 fichas
  // Solo se concede si el usuario está autenticado y tiene pocas fichas (por ejemplo <= 0)
  // requestLoan optionally accepts a payload { needed } meaning minimum fichas required
  socket.on('requestLoan', async (payload) => {
    try {
      const userId = socket.data && socket.data.userId ? socket.data.userId : null;
      if (!userId) return socket.emit('loanResult', { error: 'No autenticado. Inicia sesión primero.' });
      const user = await db.getUser(userId);
      if (!user) return socket.emit('loanResult', { error: 'Usuario no encontrado' });

      // Si el usuario tiene reservas en curso, no permitir préstamo hasta que se resuelvan
      const reservedNow = Number(globalThis.reservedByUser[userId] || 0);
      if (reservedNow > 0) return socket.emit('loanResult', { error: 'Tienes apuestas en curso. Espera al resultado antes de pedir préstamo.' });

      const currentF = Number(user.fichas || 0);
      // condición mínima para pedir préstamo: si el jugador ya tiene al menos 'needed' fichas, no conceder
      const needed = payload && Number(payload.needed) ? Number(payload.needed) : 5; // umbral por defecto: 5 fichas
      if (currentF >= needed) {
        return socket.emit('loanResult', { error: 'Aún tienes fichas suficientes para jugar' });
      }

      const grant = 10; // Peter presta 10 fichas ahora
      const newF = currentF + grant;
      await db.updateUserFichas(user.id, newF);

      // notificar al jugador
      socket.emit('loanResult', { success: true, newFichas: newF, grant });
      // actualizar su vista y emitir playerUpdate para sincronizar
      socket.emit('playerUpdate', { id: user.id, fichas: newF, elo: user.elo_score });
      // refrescar leaderboard
      const top = await db.getTopUsers(10);
      io.emit('leaderboard', top);
      console.log(`Loan granted to user ${user.username} (id=${user.id}) +${grant} fichas`);
    } catch (err) {
      console.error('Error processing loan request:', err);
      socket.emit('loanResult', { error: String(err) });
    }
  });

  socket.on('disconnect', () => {
    console.log('Socket desconectado:', socket.id);
  });
});

server.listen(PORT, () => console.log(`Servidor escuchando en http://localhost:${PORT}`));

// ----------------------
// Gestor simple de rondas
// ----------------------
// Configuración: duración de apuesta y pausa entre rondas (ms)
const BET_WINDOW_MS = 10000; // 10s para apostar
const PAUSE_MS = 5000; // 5s entre rondas

let roundCounter = 0;

async function startRoundCycle() {
  while (true) {
    try {
      roundCounter += 1;
      const roundId = `r${Date.now()}_${roundCounter}`;

      // inicializar estado de ronda
      globalThis.currentRound = {
        id: roundId,
        isOpen: true,
        bets: [],
        startedAt: Date.now(),
        endsAt: Date.now() + BET_WINDOW_MS,
        stats: { redCount: 0, blueCount: 0, redTotal: 0, blueTotal: 0, totalPot: 0 }
      };

      // emitir inicio de ronda y duración
      io.emit('roundStart', { id: roundId, duration: BET_WINDOW_MS });
      console.log('Round started', roundId);

      // tick cada segundo para que clientes muestren countdown
      const tickInterval = setInterval(() => {
        try {
          const remaining = Math.max(0, globalThis.currentRound.endsAt - Date.now());
          const duration = Math.max(0, (globalThis.currentRound.endsAt - globalThis.currentRound.startedAt) || 0);
          io.emit('roundTick', { id: roundId, remaining, duration });
          // emitir estadísticas actuales para visualización compartida
          io.emit('roundStats', globalThis.currentRound.stats);
        } catch (e) {
          console.error('Error emitting tick/stats:', e);
        }
      }, 1000);

      // esperar ventana de apuesta
      await new Promise((res) => setTimeout(res, BET_WINDOW_MS));

      // cerrar ronda
      globalThis.currentRound.isOpen = false;
      clearInterval(tickInterval);
      io.emit('roundEnd', { id: roundId });
      // wait for any in-flight placeBet handlers to finish (bounded wait)
      const MAX_WAIT = 500; // ms
      const POLL = 25; // ms
      console.log('Round ended, waiting for in-flight placeBet handlers to finish (max', MAX_WAIT, 'ms)');
      let waited = 0;
      while ((globalThis.pendingPlaceBetCount || 0) > 0 && waited < MAX_WAIT) {
        await new Promise((r) => setTimeout(r, POLL));
        waited += POLL;
      }
      console.log('Processing bets for round:', roundId, 'queuedBeforeProcessing=', globalThis.currentRound.bets.length, 'pendingPlaceBetCount=', globalThis.pendingPlaceBetCount || 0, 'waited=', waited);

      // procesar apuestas encoladas: usar UN solo RNG por ronda
  const betsToProcess = globalThis.currentRound.bets.slice();
      const dice = game.rollDice();
      for (const b of betsToProcess) {
        try {
          const opts = { alreadyReserved: !!b.reserved };
          const result = await game.processBet(b.userId, b.betAmount, b.betTarget, dice, opts);
          // enviar resultado al socket que apostó
          const targetSocket = io.sockets.sockets.get(b.socketId);
          if (targetSocket && targetSocket.connected) {
            targetSocket.emit('betResult', result);
          }
          // reducir reservado para ese usuario (la apuesta ya fue liquidada)
          try {
            globalThis.reservedByUser[b.userId] = Math.max(0, (globalThis.reservedByUser[b.userId] || 0) - b.betAmount);
          } catch (e) {}
          // Emitir actualización del jugador para sincronizar clientes. Incluir loanAvailable=true solo si no tiene reservas pendientes
          try {
            const reservedLeft = Number(globalThis.reservedByUser[result.userId] || 0);
            const loanAvailable = (result.newFichas < 5 && reservedLeft === 0);
            // Emitir primero al socket específico (si está presente) y luego broadcast para reducir probabilidad de que el cliente no reciba la actualización en su propia conexión
            try {
              if (targetSocket && targetSocket.connected) targetSocket.emit('playerUpdate', { id: result.userId, fichas: result.newFichas, elo: result.newElo, loanAvailable });
            } catch (e) {}
            try { io.emit('playerUpdate', { id: result.userId, fichas: result.newFichas, elo: result.newElo, loanAvailable }); } catch (e) {}
          } catch (e) { console.error('Error emitting playerUpdate:', e); }
        } catch (e) {
          const targetSocket = io.sockets.sockets.get(b.socketId);
          if (targetSocket && targetSocket.connected) {
            targetSocket.emit('betResult', { error: e.message });
          }
        }
      }

      // después de procesar apuestas, emitir resumen / leaderboard
      try {
        // emitir resumen de la ronda con ganador según el dado (autoridad del RNG)
        const stats = globalThis.currentRound.stats || { redTotal: 0, blueTotal: 0, redCount: 0, blueCount: 0, totalPot: 0 };
        let winner = 'tie';
        if (Number.isInteger(dice)) {
          if (dice >= 1 && dice <= 3) winner = 'red';
          else if (dice >= 4 && dice <= 6) winner = 'blue';
        } else {
          // fallback: si por alguna razón no hay dado, usar totals
          if ((stats.redTotal||0) > (stats.blueTotal||0)) winner = 'red';
          if ((stats.blueTotal||0) > (stats.redTotal||0)) winner = 'blue';
        }
        io.emit('roundSummary', { roundId, stats, winner, dice });

        const top = await db.getTopUsers(10);
        io.emit('leaderboard', top);
      } catch (e) {
        console.error('Error emitting summary/leaderboard:', e);
        // intentar emitir un resumen fallback para que clientes no queden esperando
        try {
          const stats = globalThis.currentRound && globalThis.currentRound.stats ? globalThis.currentRound.stats : { redTotal: 0, blueTotal: 0, redCount: 0, blueCount: 0, totalPot: 0 };
          let winner = 'tie';
          if ((stats.redTotal||0) > (stats.blueTotal||0)) winner = 'red';
          if ((stats.blueTotal||0) > (stats.redTotal||0)) winner = 'blue';
          io.emit('roundSummary', { roundId, stats, winner, dice: null, fallback: true });
          console.log('Emitted fallback roundSummary for', roundId);
        } catch (e2) {
          console.error('Failed to emit fallback roundSummary:', e2);
        }
      }

      // pausa antes de siguiente ronda: notificar tiempo hasta próximo inicio
      const nextStartsAt = Date.now() + PAUSE_MS;
      io.emit('roundNext', { startsIn: PAUSE_MS });
      // emitir ticks durante la pausa
      const pauseTick = setInterval(() => {
        try {
          const remainingNext = Math.max(0, nextStartsAt - Date.now());
          io.emit('roundNextTick', { remaining: remainingNext });
        } catch (e) {
          console.error('Error emitting pause tick:', e);
        }
      }, 1000);

      await new Promise((res) => setTimeout(res, PAUSE_MS));
      clearInterval(pauseTick);
    } catch (iterErr) {
      console.error('Error during round loop iteration:', iterErr);
      // pequeña espera antes de reintentar para evitar bucle caliente
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

// Iniciar ciclo de rondas en background
// Antes de arrancar, definir estado inicial
globalThis.currentRound = null;
// mapa userId -> reserved amount (cantidad actualmente reservada en apuestas en curso)
globalThis.reservedByUser = globalThis.reservedByUser || {};
// Emitir una primera notificación de próxima ronda para clientes que se conecten antes
const initialNextStarts = Date.now() + 3000; // 3s hasta la primera ronda por defecto
setTimeout(() => {
  try {
    io.emit('roundNext', { startsIn: Math.max(0, initialNextStarts - Date.now()) });
  } catch (e) {}
}, 200);

startRoundCycle().catch((err) => console.error('Round cycle error:', err));
