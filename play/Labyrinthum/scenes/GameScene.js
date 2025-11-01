

import AssetManager from '../managers/AssetManager.js';
import PlayerManager from '../managers/PlayerManager.js';
import EnemyManager from '../managers/EnemyManager.js';
import InputManager from '../managers/InputManager.js';
import UIManager from '../managers/UIManager.js';
import ProjectileManager from '../managers/ProjectileManager.js';
import { WORLD_WIDTH, WORLD_HEIGHT, CLASS_HEALTH } from '../utils.js';

export default class GameScene extends Phaser.Scene {
    constructor() {
        super({ key: 'GameScene' });
    }

    init(data) {
        this.isTransitioning = false;
        this.isOffline = data.isOffline;
        this.socketManager = data.socketManager;
        this.playerData = {
            name: data.playerName,
            class: data.playerClass,
            room: data.roomName,
            leader: data.leader,
            initialPlayers: data.players || data.initialPlayers,
            initialOnlinePlayers: data.onlinePlayers || []
        };
        
        this.hubState = {
            initialDummyHealth: data.dummyHealth,
            initialCurrentTarget: data.currentTarget
        };

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

        // Create Game Objects
        this.playerData.initialPlayers.forEach(p => {
            this.playerManager.createPlayer(p.id, p.id === this.playerData.name, p.x, p.y, p.playerClass, p.health, p.maxHealth);
        });
        
        const localPlayer = this.playerManager.getLocalPlayer();
        this.enemyManager.createTargetDummy(this.hubState.initialDummyHealth, this.hubState.initialCurrentTarget);
        
        this.towerEntrance = this.physics.add.sprite(WORLD_WIDTH / 2, WORLD_HEIGHT / 2 - 300, 'portal');
        this.towerEntrance.setImmovable(true);
        this.towerEntrance.body.setAllowGravity(false);
        this.add.text(this.towerEntrance.x, this.towerEntrance.y + 50, 'TOWER', { fontSize: '18px', color: '#e9d5ff', fontFamily: "'Bebas Neue', cursive", align: 'center' }).setOrigin(0.5);

        // Setup Systems
        this.projectileManager.createProjectileGroups();
        this.projectileManager.setupHubCollisions(this.enemyManager.targetDummy, this.handleProjectileHitDummy.bind(this));
        this.uiManager.createHubUI(this.isOffline, this.playerData.initialOnlinePlayers);
        this.uiManager.createAdminConsole();
        this.inputManager.setupHubInputs();

        // Camera
        if (localPlayer) {
             this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT).startFollow(localPlayer, true, 0.08, 0.08).setZoom(0.5);
             // The deadzone is a rectangle in the center of the camera.
             // The camera won't scroll until the player moves out of this rectangle.
             this.cameras.main.setDeadzone(this.scale.width * 0.5, this.scale.height * 0.5);
             this.physics.add.overlap(localPlayer, this.towerEntrance, this.onEnterTower, null, this);
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
                case 'online_players': this.uiManager.updatePlayerList(message.payload); break;
                case 'receive_invite': this.uiManager.handleInvite(message.payload.from); break;
                case 'player_rejoined_hub':
                    if (message.payload.id !== this.playerData.name) {
                        this.uiManager.displayStatusMessage(`${message.payload.id} returned from the tower.`);
                        const { id, x, y, playerClass, health, maxHealth } = message.payload;
                        this.playerManager.createPlayer(id, false, x, y, playerClass, health, maxHealth);
                    }
                    break;
                case 'party_updated': case 'force_join_room': this.playerManager.updatePartyState(message.payload); break;
                case 'status_update': this.uiManager.displayStatusMessage(message.payload); break;
                case 'tower_start': this.startTowerScene(message.payload); break;
                case 'move': this.playerManager.updatePlayerPosition(message.payload); break;
                case 'projectile_fired': this.projectileManager.spawnRemoteProjectile(message.payload); break;
                case 'melee_animation': this.playerManager.playMeleeAnimation(message.payload.id, message.payload.angle); break;
                case 'dummy_health_update': this.enemyManager.handleDummyHealthUpdate(message.payload); break;
                case 'player_healed': this.playerManager.handlePlayerHealed(message.payload); break;
                case 'aggro_update': this.enemyManager.updateDummyAggro(message.payload.targetId); break;
                case 'combat_event':
                    if (message.payload.entityId === 'dummy') {
                        this.uiManager.showFloatingText(this.enemyManager.targetDummy, message.payload.text, message.payload.color);
                    }
                    break;
                case 'leave': this.playerManager.removePlayer(message.payload.id); break;
            }
        });

        this.socketManager.on('close', () => {
            if (this.scene.isActive()) {
                this.uiManager.displayStatusMessage('Connection Lost! Returning to menu...', 5000);
                setTimeout(() => this.scene.isActive() && this.scene.start('LobbyScene'), 2000);
            }
        });
    }

    onEnterTower() {
        if (this.isTransitioning) return;
        this.isTransitioning = true;
    
        if (this.isOffline) {
            const localPlayer = this.playerManager.getLocalPlayer();
            const localPlayerData = [{
                id: this.playerData.name,
                x: WORLD_WIDTH / 2, y: WORLD_HEIGHT - 100,
                playerClass: this.playerData.class,
                health: localPlayer.getData('health'),
                maxHealth: localPlayer.getData('maxHealth')
            }];
            this.scene.start('TowerScene', { 
                isOffline: true, playerName: this.playerData.name, playerClass: this.playerData.class,
                players: localPlayerData, partyLeader: this.playerData.name
            });
        } else {
            this.socketManager.sendMessage('start_tower_run');
            this.uiManager.displayStatusMessage('Entering the tower...', 3000);
        }
    }
    
    startTowerScene(payload) {
        this.isTransitioning = true;
        this.scene.start('TowerScene', {
            socketManager: this.socketManager,
            playerName: this.playerData.name,
            playerClass: this.playerData.class,
            roomName: this.playerData.room,
            partyLeader: this.playerData.leader,
            initialTowerState: payload.towerState,
            players: payload.players,
            isOffline: false,
        });
    }
    
    handleProjectileHitDummy(dummy, projectile) {
        if (projectile.getData('hasHit') || dummy.getData('isDead')) return;
        projectile.setData('hasHit', true);
        this.projectileManager.kill(projectile);

        if (this.isOffline) {
            this.enemyManager.handleLocalDummyHit();
        } else if (projectile.getData('owner') === this.playerData.name) {
            this.socketManager.sendMessage('dummy_hit');
        }
    }

    update(time, delta) {
        if (this.isTransitioning) return;
        
        this.playerManager.update(this.inputManager.keys);
        this.enemyManager.updateDummyVisuals();

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

    shutdown() {
        this.isTransitioning = true;
        if (this.uiManager) this.uiManager.shutdown();
        if (this.enemyManager) this.enemyManager.shutdown();
        if (this.socketManager && !this.isOffline) {
            this.socketManager.clearMessageHandlers();
        }
        this.scale.off('resize', this.uiManager.positionHud, this.uiManager);
    }
}