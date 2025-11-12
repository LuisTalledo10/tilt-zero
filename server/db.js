// server/db.js
// Modelo de datos usando sqlite3 para Tilt Zero

const path = require('path');
const sqlite3 = require('sqlite3').verbose();

// Permitir configurar la ruta de la base de datos mediante variable de entorno DB_PATH
const DB_PATH = process.env.DB_PATH ? String(process.env.DB_PATH) : path.join(__dirname, 'tiltzero.db');
let db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    if (db) return resolve(db);
    db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) return reject(err);
      resolve(db);
    });
  });
}

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

async function initDB() {
  await openDB();

  const createTableSQL = `
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      fichas INTEGER DEFAULT 5000,
      elo_score INTEGER DEFAULT 1000
    );
  `;

  await run(createTableSQL);

  // Crear un usuario de ejemplo si no existe (opcional)
  const user = await get('SELECT * FROM users WHERE username = ?', ['player1']);
  if (!user) {
    await run('INSERT INTO users (username, fichas, elo_score) VALUES (?, ?, ?)', ['player1', 5000, 1000]);
    console.log('Usuario de ejemplo creado: player1');
  }
}

async function getUser(idOrUsername) {
  await openDB();
  if (!idOrUsername) return null;

  if (Number.isInteger(Number(idOrUsername))) {
    return await get('SELECT * FROM users WHERE id = ?', [Number(idOrUsername)]);
  }

  return await get('SELECT * FROM users WHERE username = ?', [String(idOrUsername)]);
}

async function createNewUser(username) {
  await openDB();
  const uname = String(username || `user_${Date.now()}`);
  try {
    const res = await run('INSERT INTO users (username, fichas, elo_score) VALUES (?, ?, ?)', [uname, 5000, 1000]);
    const id = res.lastID;
    return await getUser(id);
  } catch (err) {
    // si falla por unique constraint, devolver el existente
    const existing = await get('SELECT * FROM users WHERE username = ?', [uname]);
    return existing || null;
  }
}

async function updateUserFichas(id, newFichas) {
  await openDB();
  await run('UPDATE users SET fichas = ? WHERE id = ?', [Number(newFichas), Number(id)]);
  return await getUser(id);
}

// Intentar reservar fichas de forma atómica: resta `amount` si fichas >= amount.
// Devuelve el usuario actualizado si la reserva tuvo éxito, o null si no hubo saldo suficiente.
async function tryReserveFichas(id, amount) {
  await openDB();
  if (!Number.isInteger(Number(amount)) || amount <= 0) return null;
  return new Promise((resolve, reject) => {
    db.run('UPDATE users SET fichas = fichas - ? WHERE id = ? AND fichas >= ?', [Number(amount), Number(id), Number(amount)], function (err) {
      if (err) return reject(err);
      if (!this.changes || this.changes === 0) return resolve(null);
      // si se cambió, devolver el usuario actualizado
      getUser(id).then(resolve).catch(reject);
    });
  });
}

async function updateUserFichasAndElo(id, newFichas, newElo) {
  await openDB();
  await run('UPDATE users SET fichas = ?, elo_score = ? WHERE id = ?', [Number(newFichas), Number(newElo), Number(id)]);
  return await getUser(id);
}

async function getTopUsers(limit = 10) {
  await openDB();
  return new Promise((resolve, reject) => {
    db.all('SELECT id, username, fichas, elo_score FROM users ORDER BY elo_score DESC LIMIT ?', [limit], (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

module.exports = {
  initDB,
  getUser,
  createNewUser,
  updateUserFichas,
  updateUserFichasAndElo,
  getTopUsers,
  tryReserveFichas,
};
