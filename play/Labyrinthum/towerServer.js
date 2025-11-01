
const WebSocket = require('ws');
const jwt =require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const url = require('url'); // Added url module for path parsing

// [Game Constants]
const WORLD_WIDTH = 1600;
const WORLD_HEIGHT = 1200;
const SAFE_ZONE_Y_BOUNDARY = WORLD_HEIGHT - 200;
const CLASS_HEALTH = { Paladin: 150, Fighter: 100, Cleric: 80, Ranger: 100 };
const GAME_TICK_RATE = 1000 / 5; // 5 times per second

const players = {};
const rooms = {};
const DUMMY_MAX_HEALTH = 10000;

// [Cookie Parser Helper]
const parseCookies = (cookieHeader) => {
  const list = {};
  if (!cookieHeader) return list;
  cookieHeader.split(';').forEach(cookie => {
    let [name, ...rest] = cookie.split('=');
    name = name?.trim();
    if (!name) return;
    const value = rest.join('=').trim();
    if (!value) return;
    list[name] = decodeURIComponent(value);
  });
  return list;
};

const reevaluateAggro = (roomId) => {
    const room = rooms[roomId];
    if (!room || room.dummyRespawnTimer) return;

    const oldTargetId = room.currentTarget;
    let newTargetId = null;
    let maxThreat = 0; // A target must have threat > 0.

    // Anyone with threat is a potential target.
    const potentialTargets = Object.keys(room.threatTable);

    if (potentialTargets.length > 0) {
        for (const playerId of potentialTargets) {
            const playerThreat = room.threatTable[playerId] || 0;
            // Only consider players with positive threat
            if (playerThreat > 0 && playerThreat >= maxThreat) {
                maxThreat = playerThreat;
                newTargetId = playerId;
            }
        }
    }
    
    // If the target has changed, broadcast the update.
    if (oldTargetId !== newTargetId) {
        room.currentTarget = newTargetId;
        broadcastToRoomInHub(roomId, {
            type: 'aggro_update',
            room: roomId,
            payload: { targetId: newTargetId }
        });
    }
};

const broadcastToRoom = (roomId, message, excludeWs = null) => {
    Object.values(players).forEach(p => {
        if (p.roomId === roomId && p.ws !== excludeWs && p.ws.readyState === WebSocket.OPEN) {
            p.ws.send(JSON.stringify(message));
        }
    });
};

const broadcastToRoomInTower = (roomId, message, excludeWs = null) => {
    Object.values(players).forEach(p => {
        if (p.roomId === roomId && p.status === 'in_tower' && p.ws !== excludeWs && p.ws.readyState === WebSocket.OPEN) {
            p.ws.send(JSON.stringify(message));
        }
    });
};

const broadcastToRoomInHub = (roomId, message, excludeWs = null) => {
    Object.values(players).forEach(p => {
        if (p.roomId === roomId && p.status !== 'in_tower' && p.ws !== excludeWs && p.ws.readyState === WebSocket.OPEN) {
            p.ws.send(JSON.stringify(message));
        }
    });
};


const generateTowerFloor = (floor) => {
    const minions = [];
    const minionCount = 2 + Math.floor(floor / 2);
    for (let i = 0; i < minionCount; i++) {
        minions.push({
            id: `m_${floor}_${i}`,
            type: 'minion',
            x: 200 + Math.random() * 1200, // Spawn in larger world
            y: 250 + Math.random() * 700,
            health: 100 * floor,
            maxHealth: 100 * floor,
            isDead: false,
            threatTable: {},
            attackCooldown: 0,
            targetId: null,
            telegraphEndTime: null, // For telegraphing attacks
        });
    }

    return {
        currentFloor: floor,
        enemies: minions,
        boss: {
            id: `b_${floor}`,
            type: 'boss',
            x: WORLD_WIDTH / 2, // Center of larger world
            y: 150,
            health: 500 * floor * 1.5,
            maxHealth: 500 * floor * 1.5,
            isDead: false,
            threatTable: {},
            attackCooldown: 0,
            targetId: null,
            attackCounter: 0, // For varied attack patterns
        },
        projectiles: [],
        exitActive: false,
    };
};


const broadcastOnlinePlayers = () => {
    const playersInfo = Object.values(players).map(p => ({
        username: p.ws.username,
        status: p.status,
    }));
    const message = JSON.stringify({
        type: 'online_players',
        payload: playersInfo,
    });
    Object.values(players).forEach(player => {
        if (player.ws.readyState === WebSocket.OPEN) {
            player.ws.send(message);
        }
    });
};

const stopDummyHealing = (roomId) => {
    const room = rooms[roomId];
    if (!room) return;

    if (room.dummyHealTimeout) {
        clearTimeout(room.dummyHealTimeout);
        room.dummyHealTimeout = null;
    }
    if (room.dummyHealInterval) {
        clearInterval(room.dummyHealInterval);
        room.dummyHealInterval = null;
    }
};

const startDummyHealing = (roomId) => {
    const room = rooms[roomId];
    // This function should ONLY be called when we are sure we want to start the process.
    // Preliminary checks (like dummyTargetedBy.size === 0) should be done by the caller.
    if (!room || room.dummyRespawnTimer || room.dummyHealTimeout || room.dummyHealInterval) {
        return;
    }

    room.dummyHealTimeout = setTimeout(() => {
        const currentRoom = rooms[roomId];
        // Re-check conditions inside the timeout, as state might have changed.
        if (!currentRoom || currentRoom.dummyRespawnTimer || currentRoom.dummyTargetedBy.size > 0) {
            if (currentRoom) currentRoom.dummyHealTimeout = null; // Clear self if conditions are no longer met
            return;
        }

        // Clear any existing interval just in case (shouldn't happen with guards, but it's safe)
        if (currentRoom.dummyHealInterval) clearInterval(currentRoom.dummyHealInterval);
        
        currentRoom.dummyHealInterval = setInterval(() => {
            const intervalRoom = rooms[roomId];
             // This interval stops itself if conditions change (e.g., someone targets the dummy again).
             if (!intervalRoom || intervalRoom.dummyRespawnTimer || intervalRoom.dummyHealth >= DUMMY_MAX_HEALTH || intervalRoom.dummyTargetedBy.size > 0) {
                 if (intervalRoom && intervalRoom.dummyHealInterval) {
                     clearInterval(intervalRoom.dummyHealInterval);
                     intervalRoom.dummyHealInterval = null;
                 }
                 return;
             }

             intervalRoom.dummyHealth = Math.min(DUMMY_MAX_HEALTH, intervalRoom.dummyHealth + (DUMMY_MAX_HEALTH * 0.05));
             broadcastToRoomInHub(intervalRoom.id, {
                type: 'dummy_health_update',
                room: intervalRoom.id,
                payload: { health: intervalRoom.dummyHealth, isDead: false }
             });

        }, 1000);

        currentRoom.dummyHealTimeout = null; // The timeout's job is done, now the interval is running.
    }, 3000);
};

// [Game Loop]
function gameLoop() {
    Object.values(rooms).forEach(room => {
        if (!room.towerState) return;

        const tower = room.towerState;
        const playersInTower = Object.values(players).filter(p => p.roomId === room.id && p.status === 'in_tower');
        const now = Date.now();

        // --- Enemy AI ---
        const allEntities = [...tower.enemies, tower.boss];
        allEntities.forEach(entity => {
            if (entity.isDead) return;

            // Find target
            let targetId = null;
            let maxThreat = 0;
            for (const playerId in entity.threatTable) {
                const potentialTarget = players[playerId];
                if (
                    potentialTarget &&
                    potentialTarget.status === 'in_tower' &&
                    potentialTarget.y < SAFE_ZONE_Y_BOUNDARY && // Player must be outside the safe zone
                    entity.threatTable[playerId] > maxThreat
                ) {
                    maxThreat = entity.threatTable[playerId];
                    targetId = playerId;
                }
            }
            entity.targetId = targetId;
            const targetPlayer = players[targetId];
            if (!targetPlayer) return;

            // --- Floor 1 AI Logic ---
            if (tower.currentFloor === 1) {
                const distance = Math.hypot(entity.x - targetPlayer.x, entity.y - targetPlayer.y);

                if (entity.type === 'minion') {
                    const MELEE_RANGE = 70;
                    const MINION_SPEED = 150 * (GAME_TICK_RATE / 1000);
                    const ATTACK_COOLDOWN = 2500;
                    const DAMAGE = 10;
                    
                    if (entity.telegraphEndTime && now >= entity.telegraphEndTime) {
                        // Telegraph finished, now attack
                        entity.telegraphEndTime = null; // Clear the state
                        entity.attackCooldown = now + ATTACK_COOLDOWN; // Set cooldown after attack
                        
                        const currentTarget = players[entity.targetId];
                        if (currentTarget) {
                            const currentDistance = Math.hypot(entity.x - currentTarget.x, entity.y - currentTarget.y);
                            if (currentDistance <= MELEE_RANGE + 20) { // Check range again with buffer
                                currentTarget.health = Math.max(0, currentTarget.health - DAMAGE);
                                broadcastToRoomInTower(room.id, { type: 'enemy_attack', payload: { id: entity.id, targetId: currentTarget.ws.username } });
                                broadcastToRoomInTower(room.id, { type: 'player_damaged', payload: { id: currentTarget.ws.username, newHealth: currentTarget.health } });
                            }
                        }
                    } else if (distance > MELEE_RANGE && !entity.telegraphEndTime) {
                        // Move if not in range and not telegraphing
                        const angle = Math.atan2(targetPlayer.y - entity.y, targetPlayer.x - entity.x);
                        entity.x += Math.cos(angle) * MINION_SPEED;
                        entity.y += Math.sin(angle) * MINION_SPEED;
                        broadcastToRoomInTower(room.id, { type: 'enemy_move', payload: { id: entity.id, x: entity.x, y: entity.y, targetId: entity.targetId }});
                    } else if (distance <= MELEE_RANGE && now > (entity.attackCooldown || 0) && !entity.telegraphEndTime) {
                        // In range, cooldown ready, and not already telegraphing: start telegraph
                        entity.telegraphEndTime = now + 500; // Telegraph for 500ms

                        const angle = Math.atan2(targetPlayer.y - entity.y, targetPlayer.x - entity.x);
                        const telegraphDist = 40; // Distance in front of minion
                        const telegraphX = entity.x + Math.cos(angle) * telegraphDist;
                        const telegraphY = entity.y + Math.sin(angle) * telegraphDist;
                        
                        broadcastToRoomInTower(room.id, { 
                            type: 'enemy_telegraph_attack', 
                            payload: { 
                                id: entity.id,
                                x: telegraphX,
                                y: telegraphY,
                                angle: angle
                            } 
                        });
                    }

                } else if (entity.type === 'boss') {
                    const ATTACK_COOLDOWN = 3000;
                    const PROJECTILE_SPEED = 400;

                    if (now > (entity.attackCooldown || 0)) {
                         entity.attackCooldown = now + ATTACK_COOLDOWN;
                         entity.attackCounter = (entity.attackCounter || 0) + 1;
                         const angle = Math.atan2(targetPlayer.y - entity.y, targetPlayer.x - entity.x);
                         
                         // Every 3rd attack is a shotgun blast
                         if (entity.attackCounter % 3 === 0) {
                             const spread = 0.25; // Radians
                             const angles = [angle - spread, angle, angle + spread];
                             angles.forEach(shotAngle => {
                                 const velocityX = Math.cos(shotAngle) * PROJECTILE_SPEED;
                                 const velocityY = Math.sin(shotAngle) * PROJECTILE_SPEED;
                                 const projectile = {
                                     id: uuidv4(),
                                     owner: entity.id,
                                     x: entity.x,
                                     y: entity.y,
                                     vx: velocityX,
                                     vy: velocityY,
                                 };
                                 tower.projectiles.push(projectile);
                                 broadcastToRoomInTower(room.id, { type: 'enemy_projectile_fired', payload: { ...projectile }});
                             });
                         } else { // Normal attack
                             const velocityX = Math.cos(angle) * PROJECTILE_SPEED;
                             const velocityY = Math.sin(angle) * PROJECTILE_SPEED;
                             const projectile = {
                                 id: uuidv4(),
                                 owner: entity.id,
                                 x: entity.x,
                                 y: entity.y,
                                 vx: velocityX,
                                 vy: velocityY,
                             };
                             tower.projectiles.push(projectile);
                             broadcastToRoomInTower(room.id, { type: 'enemy_projectile_fired', payload: { ...projectile }});
                         }
                    }
                }
            }
        });

        // --- Projectile Update & Collision ---
        tower.projectiles = tower.projectiles.filter(proj => {
            proj.x += proj.vx * (GAME_TICK_RATE / 1000);
            proj.y += proj.vy * (GAME_TICK_RATE / 1000);
            
            if (proj.x < 0 || proj.x > WORLD_WIDTH || proj.y < 0 || proj.y > WORLD_HEIGHT) {
                return false; // Remove projectile if out of bounds
            }
            
            for (const player of playersInTower) {
                 const distance = Math.hypot(proj.x - player.x, proj.y - player.y);
                 if (distance < 32) { // 32px hitbox
                     const DAMAGE = 25;
                     player.health = Math.max(0, player.health - DAMAGE);
                     broadcastToRoomInTower(room.id, { type: 'player_damaged', payload: { id: player.ws.username, newHealth: player.health }});
                     return false; // Remove projectile on hit
                 }
            }
            return true; // Keep projectile
        });
    });
}

function setupTowerServer(server) {
    const wss = new WebSocket.Server({ noServer: true });

    server.on('upgrade', (request, socket, head) => {
        // THE FIX: Prioritize the 'x-original-url' header from iisnode.
        const originalUrl = request.headers['x-original-url'];
        const pathname = originalUrl ? url.parse(originalUrl).pathname : url.parse(request.url).pathname;

        // CRITICAL FIX: Only handle WebSocket requests for this game's specific path.
        // This prevents this server from intercepting requests meant for other games.
        // Assuming this game's client connects to '/ws'
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
        // If the path doesn't match, do nothing. This allows other 'upgrade'
        // listeners (like isotowerServer.js) to handle their own requests.
    });
    
    wss.on('connection', (ws, req) => {
        if (ws.username) {
            console.log(`Authenticated user connected: ${ws.username}`);
        } else {
            console.log('Guest client connected.');
        }
      
        ws.on('message', (message) => {
          try {
            const data = JSON.parse(message);
            const { type, payload } = data;
      
            if (type === 'auth') {
              let usernameToAuth;
      
              if (ws.isGuest) {
                  let guestName;
                  let attempts = 0;
                  const maxAttempts = 100;
                  do {
                      guestName = `Guest_${Math.floor(1000 + Math.random() * 9000)}`;
                      attempts++;
                  } while (players[guestName] && attempts < maxAttempts);
      
                  if (players[guestName]) {
                      ws.send(JSON.stringify({ type: 'error', payload: 'Could not assign a guest name. Please try again.' }));
                      ws.close();
                      return;
                  }
                  usernameToAuth = guestName;
              } else {
                  usernameToAuth = ws.username;
                  if (!usernameToAuth || players[usernameToAuth]) {
                    ws.send(JSON.stringify({ type: 'error', payload: 'Account is already logged in.' }));
                    ws.close();
                    return;
                  }
              }
      
              ws.username = usernameToAuth;
              players[usernameToAuth] = {
                ws,
                status: 'online_solo',
                roomId: usernameToAuth,
                x: WORLD_WIDTH / 2,
                y: WORLD_HEIGHT - 100,
                playerClass: null,
                health: null,
                maxHealth: null,
                towerFloorProgress: 0
              };
              rooms[usernameToAuth] = {
                id: usernameToAuth, // Add id for clarity
                leader: usernameToAuth,
                dummyHealth: DUMMY_MAX_HEALTH,
                dummyRespawnTimer: null,
                threatTable: {},
                currentTarget: null,
                towerState: null,
                readyForNextFloor: new Set(),
                dummyHealTimeout: null,
                dummyHealInterval: null,
                dummyTargetedBy: new Set(),
                threatDecayTimers: {},
              };
      
              const playersInfo = Object.values(players).map(p => ({
                  username: p.ws.username,
                  status: p.status,
              }));
      
              ws.send(JSON.stringify({
                type: 'auth_success',
                payload: {
                  id: usernameToAuth,
                  room: usernameToAuth,
                  leader: usernameToAuth,
                  onlinePlayers: playersInfo
                }
              }));
              broadcastOnlinePlayers();
              return;
            }
      
            if (!ws.username || !players[ws.username]) {
              console.log('Unauthenticated message. Closing.');
              ws.close();
              return;
            }
      
            const currentPlayer = players[ws.username];
            const roomState = rooms[currentPlayer.roomId];
      
            switch (type) {
              case 'class_selected': {
                  const { playerClass } = payload;
                  const validClasses = ['Paladin', 'Fighter', 'Cleric', 'Ranger'];
                  if (validClasses.includes(playerClass)) {
                      currentPlayer.playerClass = playerClass;
                      const health = CLASS_HEALTH[playerClass];
                      currentPlayer.health = health;
                      currentPlayer.maxHealth = health;
                      console.log(`User ${ws.username} selected class ${playerClass} with ${health} HP.`);
                  }
                  break;
              }
      
              case 'invite': {
                const { to } = payload;
                const invitee = players[to];
                if (invitee && invitee.status === 'online_solo') {
                  invitee.ws.send(JSON.stringify({ type: 'receive_invite', payload: { from: ws.username } }));
                  ws.send(JSON.stringify({ type: 'status_update', payload: `Invite sent to ${to}.` }));
                } else {
                  ws.send(JSON.stringify({ type: 'error', payload: 'Player is not available for an invite.' }));
                }
                break;
              }
      
              case 'accept_invite': {
                  const { from } = payload;
                  const inviter = players[from];
                  const accepter = players[ws.username];
              
                  if (!inviter || !accepter) {
                      ws.send(JSON.stringify({ type: 'status_update', payload: 'Could not join party. Player not found.' }));
                      return;
                  }
      
                  // Explicitly prevent joining a party that is currently inside the tower.
                  if (inviter.status === 'in_tower') {
                      ws.send(JSON.stringify({ type: 'status_update', payload: 'Cannot join: The party is currently in the tower.' }));
                      if (inviter.ws.readyState === WebSocket.OPEN) {
                          inviter.ws.send(JSON.stringify({ type: 'status_update', payload: `${ws.username} cannot join while you are in the tower.` }));
                      }
                      return;
                  }
      
                  if (['online_solo', 'in_party'].includes(inviter.status) && accepter.status === 'online_solo') {
                      const partyRoomId = inviter.roomId;
                      
                      // Cleanup the accepter's old solo room
                      const oldRoom = rooms[ws.username];
                      if (oldRoom) {
                          stopDummyHealing(ws.username);
                          if (oldRoom.dummyRespawnTimer) clearTimeout(oldRoom.dummyRespawnTimer);
                          Object.values(oldRoom.threatDecayTimers).forEach(clearInterval);
                          delete rooms[ws.username];
                      }
              
                      if (inviter.status === 'online_solo') inviter.status = 'in_party';
                      accepter.status = 'in_party';
                      accepter.roomId = partyRoomId;
              
                      const acceptedRoomState = rooms[partyRoomId];
                      if (!acceptedRoomState) {
                          ws.send(JSON.stringify({ type: 'error', payload: 'The party room no longer exists.' }));
                          return;
                      }
      
                      const playersInHub = Object.values(players).filter(p => p.roomId === partyRoomId && p.status !== 'in_tower');
                      const hubPlayerInfo = playersInHub.map(p => ({ 
                          id: p.ws.username, x: p.x, y: p.y, 
                          playerClass: p.playerClass, health: p.health, maxHealth: p.maxHealth 
                      }));
              
                      const hubUpdatePayload = {
                          room: partyRoomId,
                          leader: acceptedRoomState.leader,
                          players: hubPlayerInfo,
                          dummyHealth: acceptedRoomState.dummyHealth,
                          currentTarget: acceptedRoomState.currentTarget
                      };
              
                      playersInHub.forEach(p => {
                          const messageType = (p.ws.username === ws.username) ? 'force_join_room' : 'party_updated';
                          p.ws.send(JSON.stringify({
                              type: messageType,
                              payload: hubUpdatePayload
                          }));
                      });
                      
                      broadcastOnlinePlayers();
                  } else {
                      ws.send(JSON.stringify({ type: 'status_update', payload: 'Could not join party. Player may no longer be available.' }));
                  }
                  break;
              }
      
              case 'decline_invite': {
                const { from } = payload;
                const inviter = players[from];
                if (inviter) {
                  inviter.ws.send(JSON.stringify({ type: 'status_update', payload: `${ws.username} declined your invite.` }));
                }
                break;
              }
      
              case 'move': {
                currentPlayer.x = payload.x;
                currentPlayer.y = payload.y;
                const targetRoomId = currentPlayer.roomId;
                
                if (currentPlayer.status === 'in_tower') {
                  broadcastToRoomInTower(targetRoomId, data, ws);
                } else {
                  broadcastToRoomInHub(targetRoomId, data, ws);
                }
                break;
              }
              
              case 'shoot': {
                  if (currentPlayer.playerClass === 'Cleric') break;
                  const { x, y, velocityX, velocityY, rotation } = payload;
                  const targetRoomId = currentPlayer.roomId;
                  const broadcastMsg = {
                      type: 'projectile_fired',
                      room: targetRoomId,
                      payload: {
                          id: ws.username,
                          playerClass: currentPlayer.playerClass,
                          x, y, velocityX, velocityY, rotation
                      }
                  };
      
                  if (currentPlayer.status === 'in_tower') {
                      broadcastToRoomInTower(targetRoomId, broadcastMsg, ws);
                  } else {
                      broadcastToRoomInHub(targetRoomId, broadcastMsg, ws);
                  }
                  break;
              }
      
              case 'melee_animation': {
                  if (currentPlayer.playerClass === 'Cleric') break;
                  const targetRoomId = currentPlayer.roomId;
                  const broadcastMsg = {
                      type: 'melee_animation',
                      payload: { 
                          id: ws.username,
                          angle: payload.angle
                      }
                  };
                  if (currentPlayer.status === 'in_tower') {
                      broadcastToRoomInTower(targetRoomId, broadcastMsg, ws);
                  } else {
                      broadcastToRoomInHub(targetRoomId, broadcastMsg, ws);
                  }
                  break;
              }
      
              case 'dummy_hit': {
                  if (currentPlayer.playerClass === 'Cleric') break;
                  if (currentPlayer.status === 'in_tower' || !roomState || roomState.dummyRespawnTimer) {
                      break;
                  }
      
                  stopDummyHealing(currentPlayer.roomId);
      
                  const damageValues = { Paladin: 80, Fighter: 120, Ranger: 110 };
                  const threatModifiers = { Paladin: 1.75, Fighter: 1.0, Ranger: 0.9 };
                  const damageDealt = damageValues[currentPlayer.playerClass] || 100;
                  const modifier = threatModifiers[currentPlayer.playerClass] || 1.0;
                  const generatedThreat = damageDealt * modifier;
                  
                  roomState.threatTable[ws.username] = (roomState.threatTable[ws.username] || 0) + generatedThreat;
      
                  // Hitting the dummy is an aggro-related action, so re-evaluate the target.
                  reevaluateAggro(currentPlayer.roomId);
      
                  roomState.dummyHealth -= damageDealt;
                  let healthPayload;
      
                  if (roomState.dummyHealth <= 0) {
                      roomState.dummyHealth = 0;
                      healthPayload = { health: 0, isDead: true };
                      const roomIdForRespawn = currentPlayer.roomId;
                      
                      // Clear all threat and targeting data immediately upon death
                      roomState.threatTable = {};
                      roomState.currentTarget = null;
                      broadcastToRoomInHub(roomIdForRespawn, {
                          type: 'aggro_update',
                          room: roomIdForRespawn,
                          payload: { targetId: null }
                      });
      
                      roomState.dummyRespawnTimer = setTimeout(() => {
                          const currentRoom = rooms[roomIdForRespawn];
                          if (currentRoom) {
                              currentRoom.dummyHealth = DUMMY_MAX_HEALTH;
                              currentRoom.dummyRespawnTimer = null;
                              
                              broadcastToRoomInHub(roomIdForRespawn, {
                                  type: 'dummy_health_update',
                                  room: roomIdForRespawn,
                                  payload: { health: DUMMY_MAX_HEALTH, isDead: false }
                              });
                              // Healing will start naturally if players remain un-targeted after respawn
                          }
                      }, 2000);
      
                  } else {
                      healthPayload = { health: roomState.dummyHealth, isDead: false };
                  }
      
                  broadcastToRoomInHub(currentPlayer.roomId, {
                      type: 'dummy_health_update',
                      room: currentPlayer.roomId,
                      payload: healthPayload
                  });
                  break;
              }
      
              case 'heal_player': {
                  if (currentPlayer.playerClass !== 'Cleric') break;
                  const { targetId } = payload;
                  const targetPlayer = players[targetId];
      
                  if (!targetPlayer || targetPlayer.roomId !== currentPlayer.roomId) break;
                  
                  // In the Hub, Clerics can't heal themselves.
                  if (targetPlayer.status !== 'in_tower' && targetId === ws.username) break;
      
                  const HEAL_AMOUNT = 30;
                  targetPlayer.health = Math.min(targetPlayer.maxHealth, targetPlayer.health + HEAL_AMOUNT);
                  
                  const broadcastMsg = {
                      type: 'player_healed',
                      payload: {
                          targetId: targetId,
                          healerId: ws.username,
                          newHealth: targetPlayer.health
                      }
                  };
      
                  if (targetPlayer.status === 'in_tower') {
                      broadcastToRoomInTower(currentPlayer.roomId, broadcastMsg);
                  } else {
                      broadcastToRoomInHub(currentPlayer.roomId, broadcastMsg);
                  }
                  break;
              }
              
              case 'set_target': {
                  if (!roomState || currentPlayer.status === 'in_tower') break;
      
                  const { targetId } = payload;
                  const username = ws.username;
                  const roomId = currentPlayer.roomId;
      
                  if (targetId === 'dummy') {
                      roomState.dummyTargetedBy.add(username);
                      stopDummyHealing(roomId);
                      
                      if (roomState.threatDecayTimers[username]) {
                          clearInterval(roomState.threatDecayTimers[username]);
                          delete roomState.threatDecayTimers[username];
                      }
                      // A player targeting the dummy is an aggro-related action.
                      reevaluateAggro(roomId);
      
                  } else if (targetId === null) {
                      const wasTargeting = roomState.dummyTargetedBy.delete(username);
                      
                      // If the player was actually targeting, it's an aggro-related action.
                      if (wasTargeting) {
                         reevaluateAggro(roomId);
                      }
                      
                      if (roomState.dummyTargetedBy.size === 0) {
                          startDummyHealing(roomId);
                      }
                      
                      if (typeof roomState.threatTable[username] !== 'undefined' && roomState.threatTable[username] > 0) {
                           if (roomState.threatDecayTimers[username]) clearInterval(roomState.threatDecayTimers[username]);
                           
                           roomState.threatDecayTimers[username] = setInterval(() => {
                              const room = rooms[roomId];
                              
                              if (!room || typeof room.threatTable[username] === 'undefined') {
                                  if(room && room.threatDecayTimers[username]) {
                                      clearInterval(room.threatDecayTimers[username]);
                                      delete room.threatDecayTimers[username];
                                  }
                                  return;
                              }
                              
                              const decayAmount = DUMMY_MAX_HEALTH * 0.05; 
                              room.threatTable[username] -= decayAmount;
                              
                              if (room.threatTable[username] <= 0) {
                                  delete room.threatTable[username];
                                  if(room.threatDecayTimers[username]) {
                                      clearInterval(room.threatDecayTimers[username]);
                                      delete room.threatDecayTimers[username];
                                  }
                              }
                              // Threat decay is an aggro-related action.
                              reevaluateAggro(roomId);
      
                           }, 1000);
                      }
                  }
                  break;
              }
      
              case 'start_tower_run': {
                  if (!roomState) break;
      
                  // A player is entering the tower. This affects only the current player.
                  if (!roomState.towerState) {
                      // First person in, create the tower instance for the party.
                      const startFloor = Math.max(1, currentPlayer.towerFloorProgress + 1);
                      roomState.towerState = generateTowerFloor(startFloor);
                  }
      
                  const playersInParty = Object.values(players).filter(p => p.roomId === currentPlayer.roomId);
      
                  // Notify players remaining in the hub that this player is leaving.
                  const playersRemainingInHub = playersInParty.filter(p => p.status !== 'in_tower' && p.ws.username !== ws.username);
                  if (playersRemainingInHub.length > 0) {
                      const leaveHubMessage = { type: 'leave', room: currentPlayer.roomId, payload: { id: ws.username } };
                      playersRemainingInHub.forEach(p => {
                          if (p.ws.readyState === WebSocket.OPEN) {
                              p.ws.send(JSON.stringify(leaveHubMessage));
                          }
                      });
                  }
                  
                  // Notify players already in the tower that this player is joining.
                  const playersAlreadyInTower = playersInParty.filter(p => p.status === 'in_tower');
                  const rejoinPayload = {
                      id: ws.username,
                      x: WORLD_WIDTH / 2,
                      y: WORLD_HEIGHT - 100,
                      playerClass: currentPlayer.playerClass,
                      health: currentPlayer.health,
                      maxHealth: currentPlayer.maxHealth
                  };
                  playersAlreadyInTower.forEach(p => {
                      if (p.ws.readyState === WebSocket.OPEN) {
                          p.ws.send(JSON.stringify({ type: 'player_joined_tower_instance', payload: rejoinPayload }));
                      }
                  });
      
                  // Update current player's state
                  currentPlayer.x = WORLD_WIDTH / 2;
                  currentPlayer.y = WORLD_HEIGHT - 100;
                  currentPlayer.status = 'in_tower';
      
                  // Send the tower data to the entering player
                  const playersInTowerData = playersAlreadyInTower.map(p => ({
                      id: p.ws.username, x: p.x, y: p.y, 
                      playerClass: p.playerClass, health: p.health, maxHealth: p.maxHealth
                  }));
                  playersInTowerData.push(rejoinPayload);
      
                  ws.send(JSON.stringify({
                      type: 'tower_start',
                      payload: {
                          towerState: roomState.towerState,
                          players: playersInTowerData
                      }
                  }));
                  
                  broadcastOnlinePlayers();
                  break;
              }
      
              case 'leave_tower': {
                  if (!roomState || !roomState.towerState) break;
                  
                  currentPlayer.towerFloorProgress = Math.max(0, roomState.towerState.currentFloor - 1);
                  console.log(`Player ${ws.username} left tower, saved progress: floor ${currentPlayer.towerFloorProgress}`);
      
                  // If player was ready for next floor, remove them from the set
                  if (roomState.readyForNextFloor) {
                      roomState.readyForNextFloor.delete(ws.username);
                  }
      
                  broadcastToRoomInTower(currentPlayer.roomId, {
                      type: 'leave',
                      room: currentPlayer.roomId,
                      payload: { id: ws.username }
                  }, ws);
      
                  const playersInParty = Object.values(players).filter(p => p.roomId === currentPlayer.roomId);
                  currentPlayer.status = playersInParty.length > 1 ? 'in_party' : 'online_solo';
                  currentPlayer.x = WORLD_WIDTH / 2;
                  currentPlayer.y = WORLD_HEIGHT - 100;
      
                  const returningPlayerData = { 
                      id: ws.username, x: currentPlayer.x, y: currentPlayer.y, 
                      playerClass: currentPlayer.playerClass, health: currentPlayer.health, maxHealth: currentPlayer.maxHealth 
                  };
                  broadcastToRoomInHub(currentPlayer.roomId, {
                      type: 'player_rejoined_hub',
                      payload: returningPlayerData
                  }, ws);
                  
                  const playersInHub = playersInParty.filter(p => p.status !== 'in_tower');
                  const hubPlayersData = playersInHub.map(p => ({
                      id: p.ws.username, x: p.x, y: p.y,
                      playerClass: p.playerClass, health: p.health, maxHealth: p.maxHealth
                  }));
                  
                  const allOnlinePlayers = Object.values(players).map(p => ({
                      username: p.ws.username,
                      status: p.status,
                  }));
      
                  ws.send(JSON.stringify({
                      type: 'return_to_hub',
                      payload: {
                          players: hubPlayersData,
                          dummyHealth: roomState.dummyHealth,
                          currentTarget: roomState.currentTarget,
                          leader: roomState.leader,
                          onlinePlayers: allOnlinePlayers
                      }
                  }));
      
                  const remainingInTower = playersInParty.filter(p => p.ws !== ws && p.status === 'in_tower');
                  if (remainingInTower.length === 0) {
                      roomState.towerState = null;
                      roomState.readyForNextFloor.clear();
                      console.log(`Tower instance for room ${currentPlayer.roomId} is now empty and has been cleared.`);
                  }
                  
                  broadcastOnlinePlayers();
                  break;
              }
              
              case 'hit_tower_entity': {
                  if (currentPlayer.status !== 'in_tower' || currentPlayer.playerClass === 'Cleric') break;
                  const { entityId } = payload;
                  if (!roomState || !roomState.towerState) break;
                  
                  const tower = roomState.towerState;
                  let entity = tower.enemies.find(e => e.id === entityId);
                  if (!entity) {
                      if (tower.boss.id === entityId) {
                          entity = tower.boss;
                      }
                  }
                  
                  if (entity && !entity.isDead) {
                      const damageDealt = { Paladin: 80, Fighter: 120, Ranger: 110 }[currentPlayer.playerClass] || 100;
                      const threatModifier = { Paladin: 1.5, Fighter: 1.0, Ranger: 0.8 }[currentPlayer.playerClass] || 1.0;
                      const threatGenerated = damageDealt * threatModifier;
      
                      entity.threatTable[ws.username] = (entity.threatTable[ws.username] || 0) + threatGenerated;
                      entity.health -= damageDealt;
      
                      if (entity.health <= 0) {
                          entity.health = 0;
                          entity.isDead = true;
                      }
                      
                      broadcastToRoomInTower(currentPlayer.roomId, {
                          type: 'tower_entity_update',
                          payload: { id: entity.id, health: entity.health, isDead: entity.isDead }
                      });
      
                      const allMinionsDead = tower.enemies.every(e => e.isDead);
                      if (tower.boss.isDead && allMinionsDead && !tower.exitActive) {
                          tower.exitActive = true;
                          broadcastToRoomInTower(currentPlayer.roomId, { type: 'tower_floor_cleared' });
                      }
                  }
                  break;
              }
      
              case 'request_next_floor': {
                  if (currentPlayer.status !== 'in_tower' || !roomState || !roomState.towerState || !roomState.towerState.exitActive) {
                      break;
                  }
      
                  roomState.readyForNextFloor.add(ws.username);
      
                  const playersInTower = Object.values(players).filter(p => p.roomId === currentPlayer.roomId && p.status === 'in_tower');
                  const totalPlayers = playersInTower.length;
                  const readyPlayers = roomState.readyForNextFloor.size;
                  
                  broadcastToRoomInTower(currentPlayer.roomId, {
                      type: 'player_ready_update',
                      payload: {
                          readyCount: readyPlayers,
                          totalCount: totalPlayers,
                          player: ws.username
                      }
                  });
      
                  if (readyPlayers >= totalPlayers) {
                      roomState.readyForNextFloor.clear();
                      roomState.towerState.exitActive = false;
                      const currentFloor = roomState.towerState.currentFloor;
      
                      if (currentFloor >= 10) {
                          broadcastToRoomInTower(currentPlayer.roomId, { type: 'tower_complete' });
                          roomState.towerState = null;
                      } else {
                          roomState.towerState = generateTowerFloor(currentFloor + 1);
                          
                          const numPlayers = playersInTower.length;
                          const spacing = 100;
                          const startX = (WORLD_WIDTH / 2) - ((numPlayers - 1) * spacing) / 2;
                          const spawnY = WORLD_HEIGHT - 100;
      
                          const newPlayerPositions = playersInTower.map((p, index) => {
                              const spawnX = startX + (index * spacing);
                              p.x = spawnX;
                              p.y = spawnY;
                              return { id: p.ws.username, x: p.x, y: p.y };
                          });
                          
                          broadcastToRoomInTower(currentPlayer.roomId, {
                              type: 'tower_load_next_floor',
                              payload: { 
                                  towerState: roomState.towerState,
                                  playerPositions: newPlayerPositions
                              }
                          });
                      }
                  }
                  break;
              }
            }
      
          } catch (error) {
            console.error('Failed to process message:', message.toString(), error);
          }
        });
      
        ws.on('close', () => {
          if (ws.username && players[ws.username]) {
            const player = players[ws.username];
            const roomId = player.roomId;
            const room = rooms[roomId];
            const wasInTower = player.status === 'in_tower';
      
            if (room) {
                if (room.threatDecayTimers && room.threatDecayTimers[ws.username]) {
                    clearInterval(room.threatDecayTimers[ws.username]);
                    delete room.threatDecayTimers[ws.username];
                }
                if (room.dummyTargetedBy) {
                    room.dummyTargetedBy.delete(ws.username);
                    if (room.dummyTargetedBy.size === 0) {
                        startDummyHealing(roomId);
                    }
                }
                 if (room.readyForNextFloor) {
                      room.readyForNextFloor.delete(ws.username);
                 }
                // Disconnecting is an aggro-related event.
                reevaluateAggro(roomId);
            }
      
            delete players[ws.username];
      
            const leaveMsg = JSON.stringify({
              type: 'leave',
              room: roomId,
              payload: { id: ws.username }
            });
      
            if (wasInTower) {
              broadcastToRoomInTower(roomId, JSON.parse(leaveMsg));
            } else {
              broadcastToRoomInHub(roomId, JSON.parse(leaveMsg));
            }
      
            const remainingInRoom = Object.values(players).filter(p => p.roomId === roomId);
            
            if (room && wasInTower) {
                const remainingInTower = remainingInRoom.filter(p => p.status === 'in_tower');
                if (remainingInTower.length === 0) {
                    room.towerState = null;
                    room.readyForNextFloor.clear();
                    console.log(`Tower instance for room ${roomId} is now empty (via disconnect) and has been cleared.`);
                } else {
                   // Re-check if all remaining players are ready
                   if (room.readyForNextFloor.size >= remainingInTower.length && room.towerState && room.towerState.exitActive) {
                      // Manually trigger the next floor logic for the remaining players
                      // This is a bit tricky. It's better to just broadcast a ready update.
                      broadcastToRoomInTower(roomId, {
                          type: 'player_ready_update',
                          payload: {
                              readyCount: room.readyForNextFloor.size,
                              totalCount: remainingInTower.length,
                              player: null // System update
                          }
                      });
                   }
                }
            }
      
            if (remainingInRoom.length === 0) {
              console.log(`Room ${roomId} is empty. Deleting state.`);
              if (room) {
                if (room.dummyRespawnTimer) clearTimeout(room.dummyRespawnTimer);
                stopDummyHealing(roomId);
                Object.values(room.threatDecayTimers).forEach(clearInterval);
                delete rooms[roomId];
              }
            } else if (remainingInRoom.length === 1) {
              const lastPlayer = remainingInRoom[0];
              if (lastPlayer.status !== 'in_tower') {
                  const lastPlayerName = lastPlayer.ws.username;
                  console.log(`Player ${lastPlayerName} is now solo. Resetting room state.`);
                  lastPlayer.status = 'online_solo';
                  lastPlayer.roomId = lastPlayerName;
      
                  if (room) {
                    if (room.dummyRespawnTimer) clearTimeout(room.dummyRespawnTimer);
                    stopDummyHealing(roomId);
                    Object.values(room.threatDecayTimers).forEach(clearInterval);
                    delete rooms[roomId];
                  }
      
                  rooms[lastPlayerName] = {
                    id: lastPlayerName,
                    leader: lastPlayerName,
                    dummyHealth: DUMMY_MAX_HEALTH,
                    dummyRespawnTimer: null,
                    threatTable: {},
                    currentTarget: null,
                    towerState: null,
                    readyForNextFloor: new Set(),
                    dummyHealTimeout: null,
                    dummyHealInterval: null,
                    dummyTargetedBy: new Set(),
                    threatDecayTimers: {},
                  };
              }
            } else {
                if (room && room.leader === ws.username) {
                    const newLeader = remainingInRoom[0].ws.username;
                    room.leader = newLeader;
                    broadcastToRoom(roomId, { type: 'status_update', payload: `${newLeader} is the new party leader.` });
                }
            }
      
            broadcastOnlinePlayers();
          } else {
            console.log('Unauthenticated client disconnected');
          }
        });
      
        ws.on('error', (error) => {
          console.error('WebSocket error observed:', error);
        });
      });
      
    setInterval(gameLoop, GAME_TICK_RATE);
}

module.exports = setupTowerServer;
