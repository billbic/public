// public/play/ws/server.js
const WebSocket = require('ws');
const url = require('url');
const jwt = require('jsonwebtoken');

// Game state containers (assumed to be shared or imported)
const {
  players, rooms,
  WORLD_WIDTH, WORLD_HEIGHT,
  DUMMY_MAX_HEALTH, CLASS_HEALTH,
  broadcastOnlinePlayers,
  broadcastToRoomInHub,
  broadcastToRoomInTower,
  stopDummyHealing,
  startDummyHealing,
  reevaluateAggro,
  generateTowerFloor
} = require('./gameState'); // Adjust path if needed

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(';').forEach(cookie => {
    const [name, ...rest] = cookie.trim().split('=');
    cookies[name] = decodeURIComponent(rest.join('='));
  });
  return cookies;
}

function setupTowerSocket(server) {
  const wss = new WebSocket.Server({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const pathname = url.parse(request.url).pathname;
    if (pathname === '/ws') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        const cookies = parseCookies(request.headers.cookie);
        const token = cookies.authToken;

        if (token) {
          try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            ws.isGuest = false;
            ws.username = decoded.username;
          } catch (e) {
            ws.isGuest = true;
            ws.username = null;
          }
        } else {
          ws.isGuest = true;
          ws.username = null;
        }

        wss.emit('connection', ws, request);
      });
    }
  });

  wss.on('connection', (ws, req) => {
    // ⛓️ All your gameplay logic goes here
    // Paste the full `wss.on('connection', (ws, req) => { ... })` block here
    // from your attached file, exactly as-is
  });
}

module.exports = { setupTowerSocket };
