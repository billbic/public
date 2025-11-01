

import AssetManager from '../managers/AssetManager.js';
import PlayerManager from '../managers/PlayerManager.js';
import EnemyManager from '../managers/EnemyManager.js';
import InputManager from '../managers/InputManager.js';
import UIManager from '../managers/UIManager.js';
import ProjectileManager from '../managers/ProjectileManager.js';
import { WORLD_WIDTH, WORLD_HEIGHT, generateTowerFloor, CLASS_HEALTH } from '../utils.js';

export default class TowerScene extends Phaser.Scene {
    constructor() {
        super({ key: 'TowerScene' });
    }

    init(data) {
        this.isTransitioning = false;
        this.isOffline = data.isOffline;
        this.socketManager = data.socketManager;
        
        this.playerData = {
            name: data.playerName,
            class: data.playerClass,
            room: data.roomName,
            leader: data.partyLeader,
            initialPlayers: data.players
        };
        
        this.initialTowerState = data.initialTowerState || generateTowerFloor(1);

        if (this.playerData.class === 'Paladin' || this.playerData.class === 'Fighter') {
            this.attackType = 'melee';
        } else {
            this.attackType = 'ranged';
        }
    }

    preload() {
        this.load.setPath('play/isotower/');
        AssetManager.preload(this);
    }

    create() {
        this.physics.world.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
        const floor = this.add.tileSprite(WORLD_WIDTH / 2, WORLD_HEIGHT / 2, WORLD_WIDTH, WORLD_HEIGHT, 'floor1');
        floor.setTileScale(1).setDepth(-1000);
        floor.name = 'background_floor'; // Exclude floor from depth sorting

        // Instantiate Managers
        this.playerManager = new PlayerManager(this);
        this.enemyManager = new EnemyManager(this);
        this.projectileManager = new ProjectileManager(this);
        this.uiManager = new UIManager(this);
        this.inputManager = new InputManager(this);

        // Create Game Objects & Systems
        this.playerData.initialPlayers.forEach(p => {
            this.playerManager.createPlayer(p.id, p.id === this.playerData.name, p.x, p.y, p.playerClass, p.health, p.maxHealth);
        });
        
        const localPlayer = this.playerManager.getLocalPlayer();
        this.projectileManager.createProjectileGroups();
        this.projectileManager.setupTowerCollisions(
            this.enemyManager.towerEntitiesGroup,
            this.playerManager.playerSprites,
            this.handleProjectileHit.bind(this),
            this.onPlayerHitByProjectile.bind(this)
        );

        this.uiManager.createTowerUI();
        this.uiManager.createAdminConsole();
        this.inputManager.setupTowerInputs();
        this.enemyManager.loadFloor(this.initialTowerState);

        // Camera
        if (localPlayer) {
            this.cameras.main.setZoom(0.5);
            this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
            this.cameras.main.startFollow(localPlayer, true, 0.08, 0.08);
            // The deadzone is a rectangle in the center of the camera.
            // The camera won't scroll until the player moves out of this rectangle.
            this.cameras.main.setDeadzone(this.scale.width * 0.5, this.scale.height * 0.5);
            this.physics.add.overlap(localPlayer, this.enemyManager.exitPortal, this.onEnterExitPortal, () => !this.isTransitioning, this);
        }

        if (!this.isOffline) {
            this.setupSocketListeners();
        }

        this.events.on('shutdown', this.shutdown, this);
        this.scale.on('resize', () => this.uiManager.positionHud(), this);
    }
    
    setupSocketListeners() {
        this.socketManager.on('message', (message) => {
            if (!this.scene.isActive()) return;

            switch (message.type) {
                case 'move': this.playerManager.updatePlayerPosition(message.payload); break;
                case 'leave': this.playerManager.removePlayer(message.payload.id); break;
                case 'player_joined_tower_instance':
                    const p = message.payload;
                    this.playerManager.createPlayer(p.id, false, p.x, p.y, p.playerClass, p.health, p.maxHealth);
                    break;
                case 'projectile_fired': this.projectileManager.spawnRemoteProjectile(message.payload); break;
                case 'melee_animation': this.playerManager.playMeleeAnimation(message.payload.id, message.payload.angle); break;
                case 'tower_entity_update': this.enemyManager.handleEntityUpdate(message.payload); break;
                case 'player_healed': this.playerManager.handlePlayerHealed(message.payload); break;
                case 'tower_floor_cleared': this.enemyManager.onFloorCleared(); break;
                case 'player_ready_update': this.uiManager.displayStatusMessage(`Waiting for party... (${message.payload.readyCount}/${message.payload.totalCount} ready)`); break;
                case 'tower_load_next_floor': this.onNextFloor(message.payload); break;
                case 'tower_complete': this.onTowerComplete(); break;
                case 'return_to_hub': this.returnToHub(message.payload); break;
                case 'status_update': this.uiManager.displayStatusMessage(message.payload); break;
                case 'combat_event':
                    const targetEntity = this.enemyManager.getEntity(message.payload.entityId);
                    if (targetEntity) {
                        this.uiManager.showFloatingText(targetEntity, message.payload.text, message.payload.color);
                    }
                    break;
                // AI messages
                case 'enemy_move': this.enemyManager.handleEnemyMove(message.payload); break;
                case 'enemy_attack': this.enemyManager.handleEnemyAttack(message.payload); break;
                case 'enemy_telegraph_attack': this.enemyManager.handleEnemyTelegraph(message.payload); break;
                case 'player_damaged': this.playerManager.handlePlayerDamaged(message.payload); break;
                case 'enemy_projectile_fired': this.projectileManager.fireEnemyProjectile(message.payload); break;
            }
        });

        this.socketManager.on('close', () => {
             if (this.scene.isActive()) this.scene.start('LobbyScene');
        });
    }

    update(time, delta) {
        if (this.isTransitioning) return;
    
        this.playerManager.update(this.inputManager.keys);
        this.enemyManager.update(time, delta, this.isOffline, this.playerManager.getPlayers());
    
        // Manage global selection indicator visibility.
        if (!this.inputManager.currentTarget || !this.inputManager.currentTarget.active) {
            this.uiManager.selectionIndicator.setVisible(false);
        }

        // Depth Sorting
        this.children.each(child => {
            if (child.y && child.name !== 'background_floor') {
                child.setDepth(child.y);
            }
        });
    }

    handleProjectileHit(entity, projectile) {
        if (projectile.getData('hasHit') || entity.getData('isDead')) return;
        
        projectile.setData('hasHit', true);
        this.projectileManager.kill(projectile);

        if (this.isOffline) {
            this.enemyManager.handleLocalEntityHit(entity);
        } else if (projectile.getData('owner') === this.playerData.name) {
            this.socketManager.sendMessage('hit_tower_entity', { entityId: entity.getData('id') });
        }
    }

    onPlayerHitByProjectile(player, projectile) {
        this.projectileManager.kill(projectile);
    }

    onEnterExitPortal() {
        this.isTransitioning = true;
        this.playerManager.getLocalPlayer().body.setEnable(false);
        
        if (this.isOffline) {
            const currentFloor = this.enemyManager.getCurrentFloor();
            if (currentFloor >= 10) {
                 this.onTowerComplete();
            } else {
                 this.onNextFloor({ towerState: generateTowerFloor(currentFloor + 1) });
            }
        } else {
            this.socketManager.sendMessage('request_next_floor');
            this.uiManager.displayStatusMessage('Waiting for other players...');
        }
    }

    onNextFloor(data) {
        this.isTransitioning = false;
        this.playerManager.getLocalPlayer().body.setEnable(true);
        this.enemyManager.loadFloor(data.towerState);
        this.uiManager.displayStatusMessage('');
        
        const positions = data.playerPositions || [{ id: this.playerData.name, x: WORLD_WIDTH / 2, y: WORLD_HEIGHT - 100 }];
        this.playerManager.repositionPlayers(positions);
    }

    onTowerComplete() {
        this.uiManager.displayStatusMessage('Congratulations! Tower Complete!');
        setTimeout(() => this.leaveTower(), 3000);
    }

    leaveTower() {
        if (this.isOffline) {
            const localPlayer = this.playerManager.getLocalPlayer();
            const health = localPlayer ? localPlayer.getData('health') : CLASS_HEALTH[this.playerData.class];
            const maxHealth = localPlayer ? localPlayer.getData('maxHealth') : CLASS_HEALTH[this.playerData.class];
            
            this.scene.start('GameScene', {
                isOffline: true,
                playerName: this.playerData.name,
                playerClass: this.playerData.class,
                initialPlayers: [{
                    id: this.playerData.name,
                    x: WORLD_WIDTH / 2,
                    y: WORLD_HEIGHT - 100,
                    playerClass: this.playerData.class,
                    health: health,
                    maxHealth: maxHealth
                }]
            });
        } else {
            this.socketManager.sendMessage('leave_tower');
        }
    }
    
    returnToHub(data) {
        this.scene.start('GameScene', {
            socketManager: this.socketManager,
            playerName: this.playerData.name,
            playerClass: this.playerData.class,
            roomName: this.playerData.room,
            leader: data.leader,
            onlinePlayers: data.onlinePlayers,
            players: data.players,
            dummyHealth: data.dummyHealth,
            currentTarget: data.currentTarget
        });
    }
    
    shutdown() {
        this.isTransitioning = true;
        if (this.uiManager) this.uiManager.shutdown();
        if (this.socketManager && !this.isOffline) {
            this.socketManager.clearMessageHandlers();
        }
        this.scale.off('resize', this.uiManager.positionHud, this.uiManager);
    }
}