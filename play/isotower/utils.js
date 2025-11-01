

export const LOBBY_WIDTH = 1280;
export const LOBBY_HEIGHT = 720;
export const WORLD_WIDTH = 3200;
export const WORLD_HEIGHT = 2000;

export const CLASS_HEALTH = { Paladin: 150, Fighter: 100, Cleric: 80, Ranger: 100 };
export const DAMAGE_VALUES = { Paladin: 4, Fighter: 6, Ranger: 6, Cleric: 0 };
export const MISS_CHANCE = 0.25;

// UPDATED: The WebSocket URL now points to a specific path for this game.
export const WEBSOCKET_URL = `${window.location.origin.replace(/^http/, 'ws')}/play/isotower/ws`;

export const generateTowerFloor = (floor) => {
    const minions = [];
    const minionCount = 2 + Math.floor(floor / 2); // More minions on higher floors
    const bossX = WORLD_WIDTH / 2;
    const bossY = 300;
    const baseSpawnRadius = 150;

    for (let i = 0; i < minionCount; i++) {
        // Spawn in a semi-circle in front of (below) the boss
        // Spreading them out over a ~120 degree arc (PI/3 to 2PI/3)
        const angle = (Math.PI / 3) + (i * ((Math.PI / 3) / (minionCount > 1 ? minionCount - 1 : 1)));

        // Add some randomness to position to avoid perfect lines
        const spawnRadius = baseSpawnRadius + (Math.random() * 50 - 25); // +/- 25px radius variation
        const randomAngleOffset = (Math.random() * 0.2 - 0.1); // +/- ~6 degrees variation

        const minionX = bossX + Math.cos(angle + randomAngleOffset) * spawnRadius;
        const minionY = bossY + Math.sin(angle + randomAngleOffset) * spawnRadius;

        minions.push({
            id: `m_${floor}_${i}`,
            type: 'minion',
            x: minionX,
            y: minionY,
            health: 100 * floor,
            maxHealth: 100 * floor,
            isDead: false,
        });
    }

    return {
        currentFloor: floor,
        enemies: minions,
        boss: {
            id: `b_${floor}`,
            type: 'boss',
            x: bossX,
            y: bossY,
            health: 500 * floor * 1.5,
            maxHealth: 500 * floor * 1.5,
            isDead: false,
        },
        exitActive: false,
    };
};