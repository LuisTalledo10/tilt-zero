// server/gameLogic.js
// Lógica del juego para Tilt Zero: dado 1-6 y apuestas 'red' / 'blue' (competitivo)

const db = require('./db');

function rollDice() {
  // devuelve un entero entre 1 y 6 inclusive
  return Math.floor(Math.random() * 6) + 1;
}

/**
 * processBet:
 * - userId: id numérico o username
 * - betAmount: entero positivo
 * - betTarget: 'red' o 'blue'
 *
 * Reglas (MVP - Rojo/Azul):
 * - 'red' gana si sale 1-3
 * - 'blue' gana si sale 4-6
 * - payout 2x: ganar = +betAmount (ganancia neta), perder = -betAmount
 * - ELO: victoria +10, derrota -7 (ajustable para sensibilidad competitiva)
 */
// processBet acepta opcionalmente `forcedDice` para usar el mismo resultado para toda la ronda.
/**
 * processBet ahora soporta `forcedDice` y `options`.
 * options = { alreadyReserved: boolean }
 */
async function processBet(userId, betAmountRaw, betTargetRaw, forcedDice, options = {}) {
  const betAmount = Math.floor(Number(betAmountRaw));
  const betTarget = String(betTargetRaw || '').toLowerCase();

  if (!Number.isInteger(betAmount) || betAmount <= 0) {
    throw new Error('betAmount debe ser un entero positivo');
  }
  if (!['red', 'blue'].includes(betTarget)) {
    throw new Error("betTarget inválido. Usa 'red' o 'blue'.");
  }

  // Obtener usuario
  const user = await db.getUser(userId);
  if (!user) throw new Error('Usuario no encontrado');

  const alreadyReserved = options && options.alreadyReserved;
  // Si la apuesta no fue previamente reservada, validar saldo
  if (!alreadyReserved && user.fichas < betAmount) throw new Error('Fichas insuficientes');

  const dice = Number.isInteger(Number(forcedDice)) ? Number(forcedDice) : rollDice();
  let win = false;
  if (betTarget === 'red' && dice >= 1 && dice <= 3) win = true;
  if (betTarget === 'blue' && dice >= 4 && dice <= 6) win = true;

  // Si la apuesta ya fue reservada (montante descontado al aceptar), el ajuste final es distinto:
  // - Si perdió: no se aplica cambio adicional (ya se descontó la apuesta al aceptarla)
  // - Si ganó: debe añadirse 2 * betAmount para reflejar la devolución de la apuesta + la ganancia
  let change = 0;
  if (alreadyReserved) {
    change = win ? (2 * betAmount) : 0;
  } else {
    // comportamiento anterior: si se procesa ahora, aplicar +/- betAmount
    change = win ? betAmount : -betAmount;
  }
  const newFichas = user.fichas + change;

  // ELO competitivo: más agresivo para que el ranking cambie
  const eloChange = win ? 10 : -7;
  const newElo = (user.elo_score || 1000) + eloChange;

  // Persistir fichas y elo de forma atómica
  await db.updateUserFichasAndElo(user.id, newFichas, newElo);

  return {
    userId: user.id,
    username: user.username,
    betAmount,
    betTarget,
    dice,
    outcome: win ? 'win' : 'lose',
    change,
    newFichas,
    eloChange,
    newElo,
    timestamp: Date.now(),
  };
}

module.exports = {
  rollDice,
  processBet,
};
