# Tilt Zero - Casino Social Competitivo (MVP)

Pequeño MVP que permite competir en la 'Duelo de Gestión de Fichas' usando un dado 1-6 y apuestas 'low' (1-3) / 'high' (4-6).

Stack:
- Backend: Node.js + Express + Socket.io
- DB: SQLite3
- Frontend: HTML/CSS/JS puro

Instrucciones:
1. Instalar dependencias:

```powershell
npm install
```

2. Ejecutar servidor:

```powershell
npm start
```

3. Abrir en el navegador:

http://localhost:3000/

Notas:
- Se crea un usuario de ejemplo `player1` con 5000 fichas y ELO 1000.
- API en tiempo real: events `requestLogin`, `userData`, `placeBet`, `betResult`.
- La lógica de ELO y payout es simplificada para el MVP y puede ajustarse.

Variables de entorno
- `PORT` (opcional): puerto en el que escuchará el servidor. En hosting como Render se asigna automáticamente.
- `DB_PATH` (opcional): ruta al archivo SQLite. Por defecto `server/tiltzero.db`. Puedes personalizarla en entornos donde el filesystem es diferente.

Ejemplo `.env`:

```
PORT=3000
DB_PATH=server/tiltzero.db
```
