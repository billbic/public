// Phaser is loaded via a script tag in index.html, so it's globally available.

const LOBBY_WIDTH = 800;
const LOBBY_HEIGHT = 600;
const WORLD_WIDTH = 1600;
const WORLD_HEIGHT = 1200;
const CLASS_HEALTH = { Paladin: 150, Fighter: 100, Cleric: 80, Ranger: 100 };

// Connect to the WebSocket server running on the same host as the web page.
// This method is more robust than building the URL from protocol and host separately.
const WEBSOCKET_URL = window.location.origin.replace(/^http/, 'ws');

// This function is now shared between the server and the client for offline mode.
const generateTowerFloor = (floor) => {
    const minions = [];
    const minionCount = 2 + Math.floor(floor / 2); // More minions on higher floors
    for (let i = 0; i < minionCount; i++) {
        minions.push({
            id: `m_${floor}_${i}`,
            type: 'minion',
            x: 200 + Math.random() * 1200,
            y: 250 + Math.random() * 700,
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
            x: WORLD_WIDTH / 2,
            y: 150, // Spawn at top of screen
            health: 500 * floor * 1.5,
            maxHealth: 500 * floor * 1.5,
            isDead: false,
        },
        exitActive: false,
    };
};

class LobbyScene extends Phaser.Scene {
    constructor() {
        super({ key: 'LobbyScene' });
        this.socket = null;
        this.playerName = '';
        this.isGuest = true;
        this.statusText = null;
        this.connectButton = null;
        this.offlineButton = null;
    }
    
    create() {
        this.add.text(this.cameras.main.width / 2, 100, 'BPGAMES Multiplayer', { fontSize: '48px', color: '#fff', fontFamily: "'Bebas Neue', cursive" }).setOrigin(0.5);

        this.connectButton = this.add.text(this.cameras.main.width / 2, 280, 'Connect Online', { 
            fontSize: '32px', 
            color: '#121212', 
            fontFamily: "'Bebas Neue', cursive",
            backgroundColor: '#f97316',
            padding: { x: 40, y: 10 },
        }).setOrigin(0.5).setInteractive({ useHandCursor: true });
        
        this.offlineButton = this.add.text(this.cameras.main.width / 2, 360, 'Play Offline (Test)', { 
            fontSize: '24px', 
            color: '#ccc', 
            fontFamily: "'Bebas Neue', cursive",
            backgroundColor: '#333',
            padding: { x: 20, y: 8 },
        }).setOrigin(0.5).setInteractive({ useHandCursor: true });
        
        this.statusText = this.add.text(this.cameras.main.width / 2, 450, '', { fontSize: '24px', color: '#fff', fontStyle: 'italic', align: 'center' }).setOrigin(0.5);
        
        this.connectButton.on('pointerdown', () => {
            this.connectButton.setVisible(false);
            this.offlineButton.setVisible(false);
            this.statusText.setText('Initializing...');
            this.determinePlayerIdentity();
            this.connectToWebSocket();
        });
        
        this.offlineButton.on('pointerdown', () => {
            console.log("Starting offline mode.");
            this.scene.start('ClassSelectionScene', { isOffline: true, playerName: 'LocalTester' });
        });

        this.connectButton.on('pointerover', () => this.connectButton.setStyle({ backgroundColor: '#fb923c' }));
        this.connectButton.on('pointerout', () => this.connectButton.setStyle({ backgroundColor: '#f97316' }));
        this.offlineButton.on('pointerover', () => this.offlineButton.setStyle({ backgroundColor: '#555' }));
        this.offlineButton.on('pointerout', () => this.offlineButton.setStyle({ backgroundColor: '#333' }));
    }
    
    determinePlayerIdentity() {
        const loggedInUsername = document.body.dataset.username;

        if (loggedInUsername) {
            this.playerName = loggedInUsername;
            this.isGuest = false;
            console.log(`Player identified as logged-in user: ${this.playerName}`);
        } else {
            this.isGuest = true;
            this.playerName = 'Guest'; 
            console.log(`Player identified as a new guest. Awaiting name from server.`);
        }
    }

    connectToWebSocket() {
        this.statusText.setText('Connecting to the world...');
        if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
            return;
        }
        this.socket = new WebSocket(WEBSOCKET_URL);

        this.socket.onopen = () => {
            console.log('WebSocket connection established.');
            this.statusText.setText('Authenticating...');
            this.socket.send(JSON.stringify({
                type: 'auth',
                payload: {
                    username: this.playerName,
                    isGuest: this.isGuest
                }
            }));
        };

        this.socket.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                console.log('Received message:', message);

                switch (message.type) {
                    case 'auth_success':
                        this.scene.start('ClassSelectionScene', {
                            socket: this.socket,
                            playerName: message.payload.id,
                            roomName: message.payload.room,
                            ...message.payload
                        });
                        break;
                    case 'error':
                         this.statusText.setText(`Error: ${message.payload}`);
                         if (this.socket) this.socket.close();
                         if (this.connectButton) this.connectButton.setVisible(true);
                         if (this.offlineButton) this.offlineButton.setVisible(true);
                         break;
                }
            } catch (error) {
                console.error('Error parsing message:', event.data, error);
            }
        };

        this.socket.onerror = (event) => {
            this.statusText.setText('Connection error. Please try again.');
            console.error('WebSocket Error Event:', event);
            if (this.connectButton) this.connectButton.setVisible(true);
            if (this.offlineButton) this.offlineButton.setVisible(true);
        };
        
        this.socket.onclose = (event) => {
             if (this.scene.isActive()) {
                console.log(`WebSocket closed. Code: ${event.code}, Reason: ${event.reason}`);
                this.statusText.setText('Connection closed or failed. Please try again.');
                if (this.connectButton) this.connectButton.setVisible(true);
                if (this.offlineButton) this.offlineButton.setVisible(true);
             }
        };
    }
}

class ClassSelectionScene extends Phaser.Scene {
    constructor() {
        super({ key: 'ClassSelectionScene' });
        this.socket = null;
        this.lobbyData = {};
        this.isOffline = false;
    }

    init(data) {
        this.socket = data.socket;
        this.lobbyData = data;
        this.isOffline = data.isOffline;
    }

    preload() {
        this.load.image('paladin', 'https://www.breakingpointgames.com/play/ws/images/class_paladin.png');
        this.load.image('fighter', 'https://www.breakingpointgames.com/play/ws/images/class_fighter.png');
        this.load.image('cleric', 'https://www.breakingpointgames.com/play/ws/images/class_cleric.png');
        this.load.image('ranger', 'https://www.breakingpointgames.com/play/ws/images/class_ranger.png');
    }

    create() {
        this.add.text(this.cameras.main.width / 2, 80, 'Choose Your Class', { 
            fontSize: '48px', 
            color: '#f97316', 
            fontFamily: "'Bebas Neue', cursive",
            stroke: '#000',
            strokeThickness: 2
        }).setOrigin(0.5);

        const classChoices = [
            { name: 'Paladin', role: 'The Tank', desc: 'A stalwart defender who protects allies with immense durability.', color: 0x3b82f6, image: 'paladin' },
            { name: 'Fighter', role: 'The DPS', desc: 'A swift warrior focused on dealing maximum damage to foes.', color: 0xef4444, image: 'fighter' },
            { name: 'Cleric', role: 'The Healer', desc: 'A supportive caster who mends wounds and aids companions.', color: 0x22c55e, image: 'cleric' },
            { name: 'Ranger', role: 'The Sharpshooter', desc: 'A master of ranged combat, picking off enemies from a distance.', color: 0x10b981, image: 'ranger' }
        ];
        
        const cardSpacing = 200;
        const startX = this.cameras.main.width / 2 - (cardSpacing * (classChoices.length - 1)) / 2;

        classChoices.forEach((choice, index) => {
            const x = startX + (index * cardSpacing);
            const y = this.cameras.main.height / 2 + 30;
            this.createClassCard(x, y, choice);
        });
    }

    createClassCard(x, y, classData) {
        const card = this.add.container(x, y);
        const background = this.add.rectangle(0, 0, 180, 280, 0x111111).setStrokeStyle(2, 0x555555);
        const nameText = this.add.text(0, -110, classData.name, { fontSize: '24px', color: '#fff', fontFamily: "'Bebas Neue', cursive" }).setOrigin(0.5);
        const roleText = this.add.text(0, -88, classData.role, { fontSize: '16px', color: `#${classData.color.toString(16)}`, fontStyle: 'italic' }).setOrigin(0.5);
        const descText = this.add.text(0, 85, classData.desc, { fontSize: '14px', color: '#ccc', align: 'center', wordWrap: { width: 160 } }).setOrigin(0.5);

        const classImage = this.add.image(0, -10, classData.image).setScale(0.35);
        
        card.add([background, nameText, roleText, classImage, descText]);
        card.setSize(background.width, background.height);
        card.setInteractive({ useHandCursor: true });

        card.on('pointerover', () => {
            this.tweens.add({ targets: card, scale: 1.05, duration: 200 });
            background.setStrokeStyle(2, 0xf97316);
        });

        card.on('pointerout', () => {
            this.tweens.add({ targets: card, scale: 1, duration: 200 });
            background.setStrokeStyle(2, 0x555555);
        });
        
        card.on('pointerdown', () => this.selectClass(classData.name));
    }

    selectClass(className) {
        if (this.isOffline) {
            this.scene.start('GameScene', {
                isOffline: true,
                playerName: this.lobbyData.playerName,
                playerClass: className
            });
        } else {
            this.socket.send(JSON.stringify({
                type: 'class_selected',
                payload: { playerClass: className }
            }));
            
            const health = CLASS_HEALTH[className] || 100;
            this.scene.start('GameScene', {
                ...this.lobbyData,
                playerClass: className,
                initialPlayers: [{
                    id: this.lobbyData.playerName, 
                    x: WORLD_WIDTH / 2, 
                    y: WORLD_HEIGHT - 100,
                    playerClass: className,
                    health: health,
                    maxHealth: health
                }]
            });
        }
    }
}


class GameScene extends Phaser.Scene {
    constructor() {
        super({ key: 'GameScene' });
        this.playerSprites = {};
        this.socket = null;
        this.playerName = '';
        this.playerClass = '';
        this.attackType = 'ranged'; // Default
        this.roomName = '';
        this.partyLeader = null;
        this.keys = null;

        this.playerListUI = null;
        this.invitePopup = null;
        this.statusText = null;
        this.statusTimer = null; // Timer for clearing status text
        this.initialOnlinePlayers = [];
        this.projectiles = null;
        this.targetDummy = null;
        this.aggroIndicator = null;
        this.selectionIndicator = null;
        this.isOffline = false;
        this.towerEntrance = null;
        this.isTransitioning = false; // Flag to lock updates during scene change
        
        this.currentTarget = null;
        this.clericTarget = null;
        this.fullscreenButton = null;
        this.justTargeted = false; // Flag to prevent shooting on the same click as targeting
        this.justSetClericTarget = false; // Flag to prevent clearing cleric target on the same frame it's set
        this.fullscreenChangeHandler = null;

        // Properties to sync state when returning from tower
        this.initialDummyHealth = undefined;
        this.initialCurrentTarget = undefined;
    }

    init(data) {
        this.isTransitioning = false; // Reset transition lock on init
        this.currentTarget = null;
        this.clericTarget = null;
        this.justTargeted = false; // Reset the targeting flag
        this.justSetClericTarget = false; // Reset the cleric targeting flag

        // Correctly check the incoming data to decide the mode
        if (data.isOffline) {
            this.isOffline = true;
            this.socket = null;
            this.playerName = data.playerName;
            this.playerClass = data.playerClass;
            this.roomName = 'offline_room';
            this.initialOnlinePlayers = [];
            this.partyLeader = this.playerName;
            this.playerSprites = {};
            // Set initialPlayers for offline mode
            const health = CLASS_HEALTH[this.playerClass] || 100;
            this.initialPlayers = [{ 
                id: this.playerName, isLocal: true, x: WORLD_WIDTH / 2, y: WORLD_HEIGHT - 100, 
                playerClass: this.playerClass, health: health, maxHealth: health 
            }];
        } else {
            this.isOffline = false;
            this.socket = data.socket;
            this.playerName = data.playerName;
            this.roomName = data.roomName;
            this.playerClass = data.playerClass;
            this.partyLeader = data.leader;
            this.initialOnlinePlayers = data.onlinePlayers || [];
            this.playerSprites = {};
            this.initialPlayers = data.players || data.initialPlayers;
            this.initialDummyHealth = data.dummyHealth;
            this.initialCurrentTarget = data.currentTarget;
        }

        if (this.playerClass === 'Paladin' || this.playerClass === 'Fighter') {
            this.attackType = 'melee';
        } else {
            this.attackType = 'ranged';
        }
    }

    preload() {
        // Preload the floor texture
        this.load.image('towerFloor', 'https://www.breakingpointgames.com/play/WS/images/floor1.svg');
        this.load.image('targetDummy', 'https://www.breakingpointgames.com/play/WS/images/dummy_64px.png');
        this.load.image('aggroArrow', 'https://www.breakingpointgames.com/play/WS/images/aggroarrow_64px.png');
        this.load.image('selectionIndicator', 'https://www.breakingpointgames.com/play/ws/images/targetarrow_64px.png');
        this.load.image('portal', 'https://www.breakingpointgames.com/play/ws/images/portal_64px.png');
        this.load.image('paladin', 'https://www.breakingpointgames.com/play/ws/images/class_paladin.png');
        this.load.image('fighter', 'https://www.breakingpointgames.com/play/ws/images/class_fighter.png');
        this.load.image('cleric', 'https://www.breakingpointgames.com/play/ws/images/class_cleric.png');
        this.load.image('ranger', 'https://www.breakingpointgames.com/play/ws/images/class_ranger.png');
        
        // Preload selected state images
        this.load.image('selected_paladin', 'https://www.breakingpointgames.com/play/ws/images/selected_paladin.png');
        this.load.image('selected_fighter', 'https://www.breakingpointgames.com/play/ws/images/selected_fighter.png');
        this.load.image('selected_cleric', 'https://www.breakingpointgames.com/play/ws/images/selected_cleric.png');
        this.load.image('selected_ranger', 'https://www.breakingpointgames.com/play/ws/images/selected_ranger.png');
        
        const graphics = this.make.graphics();
        // Projectile for non-rangers
        graphics.fillStyle(0xf97316, 1);
        graphics.fillCircle(4, 4, 4);
        graphics.generateTexture('projectile', 8, 8);
        graphics.clear();
        // Arrow for ranger
        graphics.fillStyle(0x84cc16, 1);
        graphics.lineStyle(2, 0x65a30d, 1);
        graphics.beginPath();
        graphics.moveTo(5, 0);
        graphics.lineTo(10, 5);
        graphics.lineTo(5, 10);
        graphics.closePath();
        graphics.fillPath();
        graphics.strokePath();
        graphics.generateTexture('arrow', 10, 10);
        graphics.clear();
        // Melee slash effect
        graphics.lineStyle(4, 0xffff00, 0.8);
        graphics.beginPath();
        graphics.arc(32, 32, 28, Phaser.Math.DegToRad(220), Phaser.Math.DegToRad(320), false);
        graphics.strokePath();
        graphics.generateTexture('slash', 64, 64);
        graphics.destroy();
    }

    create() {
        this.physics.world.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
        this.add.tileSprite(0, 0, WORLD_WIDTH, WORLD_HEIGHT, 'towerFloor').setOrigin(0, 0);

        this.keys = this.input.keyboard.addKeys('W,A,S,D');
        this.input.keyboard.on('keydown-ESC', () => {
            this.clearTarget();
            this.setClericTarget(null);
        }, this);
        
        this.initialPlayers.forEach((playerData) => {
             this.createPlayer(playerData.id, playerData.id === this.playerName, playerData.x, playerData.y, playerData.playerClass, playerData.health, playerData.maxHealth);
        });

        // --- Tower Entrance ---
        this.towerEntrance = this.physics.add.sprite(WORLD_WIDTH / 2, 200, 'portal');
        this.towerEntrance.body.setImmovable(true).setAllowGravity(false);
        this.add.text(this.towerEntrance.x, this.towerEntrance.y + 50, 'TOWER', { 
            fontSize: '18px', color: '#e9d5ff', fontFamily: "'Bebas Neue', cursive", align: 'center' 
        }).setOrigin(0.5);
        
        // --- Targeting Visuals ---
        this.aggroIndicator = this.add.image(0, 0, 'aggroArrow').setVisible(false).setDepth(5);
        this.selectionIndicator = this.add.image(0, 0, 'selectionIndicator').setVisible(false).setDepth(5);
        
        // --- Target Dummy ---
        this.targetDummy = this.physics.add.sprite(WORLD_WIDTH / 2, WORLD_HEIGHT / 2, 'targetDummy').setOrigin(0.5).setDepth(6);
        this.targetDummy.body.setSize(64, 64).setImmovable(true).setAllowGravity(false);
        this.targetDummy.setInteractive({ useHandCursor: true });
        
        // --- Camera ---
        const localPlayer = this.playerSprites[this.playerName];
        if (localPlayer) {
             this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
             this.cameras.main.startFollow(localPlayer, true, 0.08, 0.08);
             this.physics.add.overlap(localPlayer, this.towerEntrance, this.onEnterTower, null, this);
        }

        // --- Input Handling ---
        this.input.mouse.disableContextMenu();
        
        this.targetDummy.on('pointerdown', (pointer) => {
            if (this.playerClass === 'Cleric') {
                this.displayStatusMessage("Clerics cannot attack enemies.", 1500);
                return;
            }
            if (this.targetDummy.getData('isDead')) return;
            this.setTarget(this.targetDummy);
            this.justTargeted = true;
        });

        this.input.on('pointerdown', (pointer) => {
            if (this.justTargeted) { // Prevents attacking immediately after selecting a target dummy
                this.justTargeted = false;
                return;
            }
            if (this.justSetClericTarget) { // Prevents clearing cleric target on same frame
                this.justSetClericTarget = false;
                return;
            }

            // Right-click always clears any target
            if (pointer.rightButtonDown()) {
                this.clearTarget(); // For non-clerics
                this.setClericTarget(null); // For clerics
                return;
            }

            // --- Left-click logic ---
            if (pointer.leftButtonDown()) {
                // If I am a Cleric AND I have a target selected...
                if (this.playerClass === 'Cleric' && this.clericTarget) {
                    // ...heal the target, regardless of where I clicked.
                    if (!this.isOffline) {
                        this.socket.send(JSON.stringify({ type: 'heal_player', payload: { targetId: this.clericTarget.name } }));
                    }
                } 
                // If I am NOT a cleric AND I have a combat target...
                else if (this.playerClass !== 'Cleric' && this.currentTarget) {
                    // ...attack the target.
                    if (this.attackType === 'melee') {
                        this.performMeleeAttack();
                    } else {
                        this.shoot();
                    }
                } 
                // If I click on empty space (and I'm NOT a cleric with a target)...
                else if (!pointer.gameObject) {
                    // ...only non-clerics clear their target this way.
                    if (this.playerClass !== 'Cleric') {
                        this.clearTarget();
                    }
                }
            }
        });


        const DUMMY_MAX_HEALTH = 10000;
        const initialHealth = this.initialDummyHealth !== undefined ? this.initialDummyHealth : DUMMY_MAX_HEALTH;
        this.targetDummy.setData('health', initialHealth);
        this.targetDummy.setData('maxHealth', DUMMY_MAX_HEALTH);
        this.targetDummy.setData('isDead', initialHealth <= 0);
        this.targetDummy.setData('respawnTimer', null);
        this.targetDummy.setData('aggroTargetId', this.isOffline ? null : (this.initialCurrentTarget || null));
        const dummyHealthText = this.add.text(this.targetDummy.x, this.targetDummy.y - 50, `${initialHealth} / ${DUMMY_MAX_HEALTH}`, { fontSize: '16px', color: '#fff', backgroundColor: 'rgba(0,0,0,0.5)', padding: {x:5, y:2} }).setOrigin(0.5);
        this.targetDummy.setData('healthText', dummyHealthText);
        if (initialHealth <= 0) {
            this.targetDummy.setAlpha(0.3);
        }


        // --- Projectiles ---
        this.projectiles = this.physics.add.group({
            defaultKey: 'projectile',
            maxSize: 50,
        });
        this.physics.add.overlap(this.targetDummy, this.projectiles, this.handleProjectileHitDummy, null, this);


        // --- In-Game UI ---
        this.createInGameUI();
        if (this.isOffline) {
             this.playerListUI.setVisible(false);
             this.playerListUI.setActive(false);
             const playersButton = this.children.getByName('playersButton');
             if(playersButton) playersButton.destroy();
        } else {
            this.updatePlayerList(this.initialOnlinePlayers);
        }

        // --- MULTIPLAYER LOGIC ---
        if (!this.isOffline && this.socket) {
            this.socket.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data);
                    
                    switch (message.type) {
                        case 'online_players':
                            this.updatePlayerList(message.payload);
                            break;

                        case 'receive_invite':
                            this.handleInvite(message.payload.from);
                            break;
                        
                        case 'player_rejoined_hub':
                            if (message.payload.id !== this.playerName) {
                                const { id, x, y, playerClass, health, maxHealth } = message.payload;
                                this.displayStatusMessage(`${id} returned from the tower.`);
                                this.createPlayer(id, false, x, y, playerClass, health, maxHealth);
                            }
                            break;

                        case 'party_updated':
                            this.updatePartyState(message.payload);
                            break;

                        case 'force_join_room':
                            this.displayStatusMessage(`Joining party...`);
                            this.updatePartyState(message.payload);
                            break;
                        
                        case 'status_update':
                             this.displayStatusMessage(message.payload);
                             break;
                        
                        case 'tower_start':
                            this.isTransitioning = true;
                            this.scene.start('TowerScene', {
                                socket: this.socket,
                                playerName: this.playerName,
                                playerClass: this.playerClass,
                                roomName: this.roomName,
                                partyLeader: this.partyLeader,
                                initialTowerState: message.payload.towerState,
                                players: message.payload.players,
                                isOffline: false,
                            });
                            break;

                        case 'move':
                            if (message.room === this.roomName) {
                                this.updatePlayerPosition(message.payload);
                            }
                            break;

                        case 'projectile_fired':
                             if (message.room === this.roomName && message.payload.id !== this.playerName) {
                                this.spawnRemoteProjectile(message.payload);
                             }
                             break;
                        
                        case 'melee_animation':
                            if (message.payload.id !== this.playerName) {
                                this.playMeleeAnimation(message.payload.id, message.payload.angle);
                            }
                            break;
                        
                        case 'dummy_health_update':
                            this.handleDummyHealthUpdate(message.payload);
                            break;
                        
                        case 'player_healed':
                            this.handlePlayerHealed(message.payload);
                            break;
                        
                        case 'aggro_update':
                            if (this.targetDummy && message.room === this.roomName) {
                                this.targetDummy.setData('aggroTargetId', message.payload.targetId);
                            }
                            break;

                        case 'leave':
                            if (message.room === this.roomName) {
                                this.removePlayer(message.payload.id);
                            }
                            break;
                    }

                } catch (error) {
                    console.error('Error processing game message:', error);
                }
            };
            
            this.socket.onclose = () => {
                if (this.scene.isActive()) {
                    this.displayStatusMessage('Connection Lost! Returning to menu...', 5000);
                    setTimeout(() => {
                        if (this.scene.isActive()) {
                            this.scene.start('LobbyScene');
                        }
                    }, 2000);
                }
            };
        }
        
        this.events.on('shutdown', this.shutdown, this);
    }
    
    onEnterTower() {
        if (this.isTransitioning) return;
    
        this.isTransitioning = true;
    
        if (this.isOffline) {
            const localPlayerSprite = this.playerSprites[this.playerName];
            const localPlayerData = [{
                id: this.playerName,
                x: WORLD_WIDTH / 2,       // Spawn in safe zone
                y: WORLD_HEIGHT - 100,    // Spawn in safe zone
                playerClass: this.playerClass,
                health: localPlayerSprite.getData('health'),
                maxHealth: localPlayerSprite.getData('maxHealth')
            }];
            this.scene.start('TowerScene', { 
                isOffline: true,
                playerName: this.playerName,
                playerClass: this.playerClass,
                players: localPlayerData,
                partyLeader: this.playerName
            });
        } else {
            this.socket.send(JSON.stringify({ type: 'start_tower_run' }));
            this.displayStatusMessage('Entering the tower...', 3000);
        }
    }
    
    displayStatusMessage(message, duration = 3000) {
        if (this.statusText) {
            this.statusText.setText(message);
            if (this.statusTimer) {
                clearTimeout(this.statusTimer);
            }
            this.statusTimer = setTimeout(() => {
                if (this.statusText) {
                    this.statusText.setText('');
                }
            }, duration);
        }
    }

    createInGameUI() {
        const disconnectButton = this.add.text(10, 10, 'Disconnect', { fontSize: '16px', color: '#ef4444', backgroundColor: '#111', padding: { x: 10, y: 5 } }).setOrigin(0, 0).setInteractive().setScrollFactor(0);
        
        disconnectButton.on('pointerdown', () => {
            if (!this.isOffline && this.socket && this.socket.readyState === WebSocket.OPEN) {
                this.socket.close();
            } else {
                this.scene.start('LobbyScene');
            }
        });
        
        this.statusText = this.add.text(this.cameras.main.width / 2, 30, '', { fontSize: '18px', color: '#f97316', fontStyle: 'italic', align: 'center' }).setOrigin(0.5).setScrollFactor(0);

        this.fullscreenButton = this.add.text(this.cameras.main.width - 10, 10, '[ ]', { fontSize: '24px', fontStyle: 'bold', color: '#f97316', backgroundColor: '#111', padding: {x: 5, y:0}, align: 'center'})
            .setOrigin(1, 0)
            .setInteractive({ useHandCursor: true })
            .setScrollFactor(0);
        
        // Define a handler for fullscreen changes to avoid scope issues with 'this'
        this.fullscreenChangeHandler = () => {
            // Only update if this scene is still active
            if (!this.scene.isActive()) {
                return;
            }
            const rootEl = document.getElementById('root');
            if (this.fullscreenButton) {
                if (document.fullscreenElement === rootEl) {
                    this.fullscreenButton.setText('[X]');
                } else {
                    this.fullscreenButton.setText('[ ]');
                }
            }
        };
        // Add the event listener to the document
        document.addEventListener('fullscreenchange', this.fullscreenChangeHandler);

        // Handle button click using native Fullscreen API
        this.fullscreenButton.on('pointerdown', () => {
            const rootEl = document.getElementById('root');
            if (rootEl) {
                if (!document.fullscreenElement) {
                    rootEl.requestFullscreen().catch(err => {
                        console.error(`Error attempting to enable full-screen mode: ${err.message} (${err.name})`);
                    });
                } else {
                    if (document.exitFullscreen) {
                        document.exitFullscreen();
                    }
                }
            }
        });

        const playersButton = this.add.text(this.fullscreenButton.x - this.fullscreenButton.width - 10, 10, 'Players', { fontSize: '16px', color: '#f97316', backgroundColor: '#111', padding: { x: 10, y: 5 } })
            .setOrigin(1, 0)
            .setInteractive()
            .setName('playersButton')
            .setScrollFactor(0);
        
        const playerListHTML = `
             <div class="player-list-container">
                <h2 class="player-list-header">Available Players</h2>
                <div id="playerList"></div>
             </div>
        `;
        this.playerListUI = this.add.dom(this.cameras.main.width - 145, this.cameras.main.height / 2).createFromHTML(playerListHTML).setVisible(false).setScrollFactor(0);

        playersButton.on('pointerdown', () => this.playerListUI.setVisible(!this.playerListUI.visible));

        const invitePopupHTML = `
            <div class="invite-popup-overlay">
                <div class="invite-popup-content">
                    <p id="inviteText" class="invite-popup-text"></p>
                    <div class="invite-popup-actions">
                        <button id="acceptBtn" class="invite-popup-btn btn-accept">Accept</button>
                        <button id="declineBtn" class="invite-popup-btn btn-decline">Decline</button>
                    </div>
                </div>
            </div>
        `;
        this.invitePopup = document.createElement('div');
        this.invitePopup.innerHTML = invitePopupHTML;
        this.invitePopup.style.display = 'none';
        document.getElementById('root').appendChild(this.invitePopup);
    }
    
    updatePlayerList(players) {
        const playerListDiv = this.playerListUI.getChildByID('playerList');
        if (!playerListDiv) return;
        playerListDiv.innerHTML = '';

        const displayablePlayers = players.filter(p => p.username !== this.playerName);

        if (displayablePlayers.length === 0) {
            playerListDiv.innerHTML = '<p class="player-status">No other players online.</p>';
            return;
        }

        displayablePlayers.forEach(player => {
            const playerEntry = document.createElement('div');
            playerEntry.className = 'player-entry';
            
            const playerNameSpan = document.createElement('span');
            playerNameSpan.textContent = player.username;
            playerNameSpan.className = 'player-name';
            playerEntry.appendChild(playerNameSpan);

            const statusSpan = document.createElement('span');
            statusSpan.className = 'player-status';

            if (player.status === 'online_solo') {
                const inviteButton = document.createElement('button');
                inviteButton.textContent = 'Invite';
                inviteButton.className = 'player-invite-btn';
                inviteButton.onclick = () => {
                    this.socket.send(JSON.stringify({ type: 'invite', payload: { to: player.username } }));
                    this.displayStatusMessage(`Inviting ${player.username}...`);
                    inviteButton.disabled = true;
                    inviteButton.textContent = 'Sent';
                };
                playerEntry.appendChild(inviteButton);
            } else {
                 if (player.status === 'in_party') {
                    statusSpan.textContent = '(In Party)';
                } else if (player.status === 'in_tower') {
                    statusSpan.textContent = '(In Tower)';
                    statusSpan.classList.add('player-status--tower');
                }
                 playerEntry.appendChild(statusSpan);
            }
            
            playerListDiv.appendChild(playerEntry);
        });
    }


    handleInvite(fromPlayer) {
        this.invitePopup.style.display = 'flex'; // Use flex to center overlay
        this.invitePopup.querySelector('#inviteText').textContent = `${fromPlayer} invites you to their party!`;
        this.invitePopup.querySelector('#acceptBtn').onclick = () => {
            this.socket.send(JSON.stringify({ type: 'accept_invite', payload: { from: fromPlayer } }));
            this.invitePopup.style.display = 'none';
        };
        this.invitePopup.querySelector('#declineBtn').onclick = () => {
            this.socket.send(JSON.stringify({ type: 'decline_invite', payload: { from: fromPlayer } }));
            this.invitePopup.style.display = 'none';
        };
    }

    updatePartyState(data) {
        this.roomName = data.room;
        this.partyLeader = data.leader;
    
        const currentSpriteNames = new Set(Object.keys(this.playerSprites));
        const newSpriteNames = new Set(data.players.map(p => p.id));
    
        for (const name of currentSpriteNames) {
            if (!newSpriteNames.has(name)) {
                if (name !== this.playerName) {
                    this.removePlayer(name);
                }
            }
        }
    
        data.players.forEach(p => {
            const existingSprite = this.playerSprites[p.id];
            if (!existingSprite) {
                const { id, x, y, playerClass, health, maxHealth } = p;
                const isLocal = id === this.playerName;
                this.createPlayer(id, isLocal, x, y, playerClass, health, maxHealth);
            }
        });
    
        if (typeof data.dummyHealth !== 'undefined') {
            this.setDummyHealth(data.dummyHealth);
        }
        if (this.targetDummy) {
            this.targetDummy.setData('aggroTargetId', data.currentTarget || null);
        }
    }
    
    createPlayer(name, isLocal, x, y, playerClass, health, maxHealth) {
        if (this.playerSprites[name]) return;
    
        const startX = x ?? WORLD_WIDTH / 2;
        const startY = y ?? WORLD_HEIGHT - 100;
    
        const playerContainer = this.add.container(startX, startY);
        playerContainer.setName(name);
    
        let imageKey;
        switch (playerClass) {
            case 'Paladin': imageKey = 'paladin'; break;
            case 'Fighter': imageKey = 'fighter'; break;
            case 'Cleric': imageKey = 'cleric'; break;
            case 'Ranger': imageKey = 'ranger'; break;
            default: imageKey = 'fighter'; break;
        }
    
        const playerSprite = this.add.image(0, 0, imageKey).setScale(0.25);
    
        const nameColor = isLocal ? '#f97316' : '#fff';
        const playerNameText = this.add.text(0, -72, name, { fontSize: '14px', color: nameColor }).setOrigin(0.5);
    
        const healthBar = this.add.graphics();
        playerContainer.add([playerSprite, playerNameText, healthBar]);
        this.physics.add.existing(playerContainer);
        playerContainer.setDepth(10);
    
        playerContainer.body.setSize(playerSprite.displayWidth, playerSprite.displayHeight);
        playerContainer.body.setCollideWorldBounds(true);
    
        playerContainer.setData({
            playerClass: playerClass,
            health: health,
            maxHealth: maxHealth,
            healthBar: healthBar
        });
        this.updatePlayerHealthBar(playerContainer);
    
        const interactiveArea = new Phaser.Geom.Rectangle(-playerSprite.displayWidth/2, -playerSprite.displayHeight/2, playerSprite.displayWidth, playerSprite.displayHeight);
        playerContainer.setInteractive(interactiveArea, Phaser.Geom.Rectangle.Contains);
        playerContainer.on('pointerdown', (pointer) => {
            if (pointer.leftButtonDown()) this.handlePlayerClick(playerContainer);
        });

        this.playerSprites[name] = playerContainer;
    }

    updatePlayerHealthBar(playerContainer) {
        const healthBar = playerContainer.getData('healthBar');
        const health = playerContainer.getData('health');
        const maxHealth = playerContainer.getData('maxHealth');
        if (!healthBar || typeof health === 'undefined' || typeof maxHealth === 'undefined') return;

        healthBar.clear();
        if (health <= 0) return;

        const barWidth = 40;
        const barHeight = 5;
        const x = -barWidth / 2;
        const y = -60;

        healthBar.fillStyle(0x000000, 0.7);
        healthBar.fillRect(x, y, barWidth, barHeight);

        const healthPercentage = health / maxHealth;
        if (healthPercentage > 0) {
            healthBar.fillStyle(0x22c55e, 1);
            healthBar.fillRect(x, y, barWidth * healthPercentage, barHeight);
        }
    }

    handlePlayerClick(targetContainer) {
        if (this.playerClass !== 'Cleric') return;

        if (targetContainer.name === this.playerName) {
            this.displayStatusMessage("You can't heal yourself in the Hub.", 1500);
            return;
        }

        // This function now ONLY sets the target. Healing is handled by the global click handler.
        this.setClericTarget(targetContainer);
        this.justSetClericTarget = true; // Prevents the global handler from firing on this same click.
    }
    
    setClericTarget(targetContainer) {
        // Deselect the old target if it exists by reverting its texture
        if (this.clericTarget && this.clericTarget.getData('originalTexture')) {
            const oldSprite = this.clericTarget.list[0];
            const originalTexture = this.clericTarget.getData('originalTexture');
            if (oldSprite && originalTexture) {
                oldSprite.setTexture(originalTexture);
            }
            this.clericTarget.setData('originalTexture', null);
        }
    
        this.clericTarget = targetContainer;
    
        // Select the new target if it exists by swapping its texture
        if (this.clericTarget) {
            const newSprite = this.clericTarget.list[0]; // The actual image sprite is the first element
            const playerClass = this.clericTarget.getData('playerClass');
            
            if (newSprite && playerClass) {
                // Store the original texture before changing it
                this.clericTarget.setData('originalTexture', newSprite.texture.key);
    
                let selectedTextureKey;
                switch(playerClass) {
                    case 'Paladin': selectedTextureKey = 'selected_paladin'; break;
                    case 'Fighter': selectedTextureKey = 'selected_fighter'; break;
                    case 'Cleric': selectedTextureKey = 'selected_cleric'; break;
                    case 'Ranger': selectedTextureKey = 'selected_ranger'; break;
                }
    
                if (selectedTextureKey) {
                    newSprite.setTexture(selectedTextureKey);
                }
            }
        }
    }
    
    handlePlayerHealed(payload) {
        const { targetId, newHealth } = payload;
        const targetSprite = this.playerSprites[targetId];
        if (targetSprite) {
            targetSprite.setData('health', newHealth);
            this.updatePlayerHealthBar(targetSprite);
            
            const spriteImage = targetSprite.list[0];
            if (spriteImage) {
                // This tween configuration is robust against rapid firing.
                // It applies a green tint and uses yoyo to fade back.
                // The onComplete callback is a safeguard to ensure the tint is cleared.
                this.tweens.add({
                    targets: spriteImage,
                    tint: 0x22c55e,
                    duration: 200,
                    yoyo: true,
                    onComplete: () => {
                        if (spriteImage && spriteImage.active) {
                            spriteImage.clearTint();
                        }
                    }
                });
            }
        }
    }

    removePlayer(id) {
        const sprite = this.playerSprites[id];
        if (sprite) {
            this.displayStatusMessage(`${id} left the party.`);
            sprite.destroy();
            delete this.playerSprites[id];
        }
    }
    
    updatePlayerPosition(data) {
        // The server sends `data.id`, `data.x`, and `data.y`.
        // Ensure you are accessing these properties correctly.
        const opponentSprite = this.playerSprites[data.id];
        if (opponentSprite) {
            this.tweens.add({
                targets: opponentSprite,
                x: data.x,
                y: data.y,
                duration: 50, // A short duration for smooth interpolation
                ease: 'Linear'
            });
        }
    }

    performMeleeAttack() {
        if (!this.currentTarget || !this.currentTarget.active) {
            this.clearTarget();
            return;
        }
        if (this.attackType !== 'melee') {
            this.displayStatusMessage("You can't attack up close!", 1000);
            return;
        }
    
        const localPlayer = this.playerSprites[this.playerName];
        const MELEE_RANGE = 100;
        const distance = Phaser.Math.Distance.Between(localPlayer.x, localPlayer.y, this.currentTarget.x, this.currentTarget.y);
    
        if (distance > MELEE_RANGE) {
            this.displayStatusMessage('Target is too far away!', 1000);
            return;
        }

        const angle = Phaser.Math.Angle.Between(localPlayer.x, localPlayer.y, this.currentTarget.x, this.currentTarget.y);
    
        this.playMeleeAnimation(this.playerName, angle);
        if (!this.isOffline) {
            this.socket.send(JSON.stringify({ type: 'melee_animation', payload: { id: this.playerName, angle: angle } }));
        }
    
        if (this.isOffline) {
            this.handleLocalDummyHit();
        } else {
            this.socket.send(JSON.stringify({ type: 'dummy_hit' }));
        }
    }

    playMeleeAnimation(playerId, angle) {
        const playerSpriteContainer = this.playerSprites[playerId];
        if (!playerSpriteContainer || playerSpriteContainer.getData('isAttacking')) return;
    
        playerSpriteContainer.setData('isAttacking', true);
        
        const distance = 40; // How far in front of the player
        const slashX = playerSpriteContainer.x + Math.cos(angle) * distance;
        const slashY = playerSpriteContainer.y + Math.sin(angle) * distance;
        
        const slash = this.add.image(slashX, slashY, 'slash').setRotation(angle + Math.PI / 2).setDepth(playerSpriteContainer.depth + 1);
        
        this.tweens.add({
            targets: slash,
            alpha: 0,
            duration: 250,
            ease: 'Cubic.easeOut',
            onComplete: () => {
                slash.destroy();
            }
        });
    
        this.time.delayedCall(150, () => {
            if (playerSpriteContainer && playerSpriteContainer.active) {
                playerSpriteContainer.setData('isAttacking', false);
            }
        });
    }

    shoot() {
        if (this.attackType !== 'ranged') {
            this.displayStatusMessage("You can't attack from range!", 1000);
            return;
        }
        if (!this.currentTarget) {
            this.displayStatusMessage("You don't have a target!", 1500);
            return;
        }
        
        const localPlayer = this.playerSprites[this.playerName];
        if (!localPlayer) return;

        const projectileTexture = this.playerClass === 'Ranger' ? 'arrow' : 'projectile';
        const projectile = this.projectiles.get(localPlayer.x, localPlayer.y, projectileTexture);
        
        if (projectile) {
            const angle = Phaser.Math.Angle.Between(localPlayer.x, localPlayer.y, this.currentTarget.x, this.currentTarget.y);
            projectile.setRotation(angle + Math.PI / 2); // Adjust for texture orientation
            projectile.setData('owner', this.playerName);
            projectile.setData('hasHit', false);
            projectile.setActive(true).setVisible(true);
            this.physics.moveToObject(projectile, this.currentTarget, 600);
            
            if (!this.isOffline) {
                this.socket.send(JSON.stringify({
                    type: 'shoot',
                    payload: {
                        x: projectile.x,
                        y: projectile.y,
                        velocityX: projectile.body.velocity.x,
                        velocityY: projectile.body.velocity.y,
                        rotation: projectile.rotation
                    }
                }));
            }
        }
    }

    spawnRemoteProjectile(data) {
        const texture = data.playerClass === 'Ranger' ? 'arrow' : 'projectile';
        const projectile = this.projectiles.get(data.x, data.y, texture);
        if (projectile) {
            projectile.setRotation(data.rotation);
            projectile.setData('owner', data.id);
            projectile.setData('hasHit', false);
            projectile.setActive(true).setVisible(true);
            projectile.body.setVelocity(data.velocityX, data.velocityY);
        }
    }

    handleProjectileHitDummy(dummy, projectile) {
        if (projectile.getData('hasHit') || dummy.getData('isDead')) {
            return;
        }
        projectile.setData('hasHit', true);

        projectile.setActive(false).setVisible(false);
        projectile.body.stop();
        this.projectiles.killAndHide(projectile);

        if (this.isOffline) {
            this.handleLocalDummyHit();
        } else {
            if (projectile.getData('owner') === this.playerName) {
                this.socket.send(JSON.stringify({ type: 'dummy_hit' }));
            }
        }
    }
    
    handleLocalDummyHit() {
        // Set aggro on first hit if dummy is alive and has no target
        if (!this.targetDummy.getData('isDead') && !this.targetDummy.getData('aggroTargetId')) {
            this.targetDummy.setData('aggroTargetId', this.playerName);
        }
    
        let currentHealth = this.targetDummy.getData('health');
        currentHealth -= 100;
    
        if (currentHealth <= 0) {
            this.handleDummyHealthUpdate({ health: 0, isDead: true });
    
            this.targetDummy.setData('isDead', true);
            this.targetDummy.setData('aggroTargetId', null); // Dummy is dead, drops aggro
    
            // Set up respawn
            if (this.targetDummy.getData('respawnTimer')) clearTimeout(this.targetDummy.getData('respawnTimer'));
            this.targetDummy.setData('respawnTimer', setTimeout(() => {
                if (!this.targetDummy || !this.targetDummy.scene) return; // Scene might have been destroyed
                this.handleDummyHealthUpdate({ health: this.targetDummy.getData('maxHealth'), isDead: false });
                this.targetDummy.setData('isDead', false);
                this.targetDummy.setData('aggroTargetId', null); // Explicitly clear aggro on respawn
            }, 2000));
        } else {
            this.handleDummyHealthUpdate({ health: currentHealth, isDead: false });
        }
    }
    
    setDummyHealth(health) {
        if (!this.targetDummy || !this.targetDummy.active) return;
    
        this.targetDummy.setData('health', health);
        const healthText = this.targetDummy.getData('healthText');
        const maxHealth = this.targetDummy.getData('maxHealth');
        healthText.setText(`${health} / ${maxHealth}`);
        
        const visual = this.targetDummy;
        if (health <= 0) {
             visual.setAlpha(0.3);
        } else {
             visual.setAlpha(1);
        }
    }

    handleDummyHealthUpdate(payload) {
        if (!this.targetDummy || !this.targetDummy.active) return;
    
        const { health, isDead } = payload;
        const oldHealth = this.targetDummy.getData('health');
        
        this.setDummyHealth(health);
        const visual = this.targetDummy;
    
        if (health > oldHealth) { // Healing
            this.tweens.add({
                targets: visual,
                tint: 0x22c55e,
                duration: 250,
                yoyo: true,
            });
        } else if (health < oldHealth) { // Damage
            this.tweens.add({
                targets: visual,
                tint: 0xef4444,
                duration: 150,
                yoyo: true,
            });
        }
    
        this.targetDummy.setData('isDead', isDead);
        if (isDead) {
            this.displayStatusMessage('Target Dummy Destroyed! Resetting...');
            this.targetDummy.setData('aggroTargetId', null);
            this.clearTarget(); // You can't target a dead dummy
            
            this.projectiles.children.each(p => {
                if (p.active) {
                    p.setActive(false).setVisible(false).body.stop();
                    this.projectiles.killAndHide(p);
                }
            });

            this.tweens.add({
                targets: visual,
                alpha: 0.3,
                yoyo: true,
                repeat: 3,
                duration: 250,
                onComplete: () => {
                    visual.setAlpha(1);
                }
            });
        }
    }

    setTarget(target) {
        if (this.playerClass === 'Cleric') return;
        this.currentTarget = target;

        if (this.currentTarget === this.targetDummy) {
            if (!this.isOffline) {
                this.socket.send(JSON.stringify({ type: 'set_target', payload: { targetId: 'dummy' } }));
            }
        }
    }

    clearTarget() {
        if (!this.currentTarget) return;
        
        const hadTarget = this.currentTarget === this.targetDummy;
        this.currentTarget = null;

        if (hadTarget && !this.isOffline) {
            this.socket.send(JSON.stringify({ type: 'set_target', payload: { targetId: null } }));
        }
    }

    update() {
        if (this.isTransitioning) return;

        const localPlayer = this.playerSprites[this.playerName];
        if (!localPlayer || !localPlayer.body) return;

        const speed = 250;
        const body = localPlayer.body;
        
        body.setVelocity(0);

        if (this.keys.A.isDown) body.setVelocityX(-speed);
        else if (this.keys.D.isDown) body.setVelocityX(speed);

        if (this.keys.W.isDown) body.setVelocityY(-speed);
        else if (this.keys.S.isDown) body.setVelocityY(speed);
        
        body.velocity.normalize().scale(speed);
        
        if (!this.isOffline && (body.velocity.x !== 0 || body.velocity.y !== 0)) {
            this.socket.send(JSON.stringify({
                type: 'move',
                room: this.roomName,
                payload: { id: this.playerName, x: localPlayer.x, y: localPlayer.y }
            }));
        }
        
        // --- Depth Sorting ---
        // Sort players based on their y-position to create a pseudo-3D effect.
        // Players lower on the screen will appear in front of players higher up.
        Object.values(this.playerSprites).forEach(sprite => {
            if (sprite && sprite.active) {
                sprite.setDepth(sprite.y);
            }
        });

        // --- Target Indicator Logic ---
        const aggroIndicator = this.aggroIndicator;
        const selectionIndicator = this.selectionIndicator;
        
        if (!aggroIndicator || !selectionIndicator || !this.targetDummy || !this.targetDummy.active) {
            return;
        }
        
        const aggroTargetId = this.targetDummy.getData('aggroTargetId');

        // Priority 1: Dummy has aggro. Show the aggro arrow and hide selection.
        if (aggroTargetId) {
            selectionIndicator.setVisible(false);
            const aggroTargetSprite = this.playerSprites[aggroTargetId];
            if (aggroTargetSprite) {
                aggroIndicator.setVisible(true);
                const arrowPosX = this.targetDummy.x;
                const arrowPosY = this.targetDummy.y + (this.targetDummy.height / 2) + 10;
                const angle = Phaser.Math.Angle.Between(arrowPosX, arrowPosY, aggroTargetSprite.x, aggroTargetSprite.y);
                aggroIndicator.setPosition(arrowPosX, arrowPosY);
                aggroIndicator.setRotation(angle + Math.PI / 2);
            } else {
                aggroIndicator.setVisible(false);
            }
        }
        // Priority 2: No aggro, but the local player is targeting the dummy. Show selection reticle.
        else if (this.currentTarget === this.targetDummy) {
            aggroIndicator.setVisible(false);
            selectionIndicator.setVisible(true);
            const reticlePosY = this.targetDummy.y + (this.targetDummy.height / 2) + 5;
            selectionIndicator.setPosition(this.targetDummy.x, reticlePosY);
        }
        // Priority 3: No aggro, no target. Hide both.
        else {
            aggroIndicator.setVisible(false);
            selectionIndicator.setVisible(false);
        }
        
        this.projectiles.children.each(p => {
            if (p.active && (p.y < 0 || p.y > this.physics.world.bounds.height || p.x < 0 || p.x > this.physics.world.bounds.width)) {
                p.setActive(false).setVisible(false).body.stop();
            }
        });
    }

    shutdown() {
        if (this.invitePopup && this.invitePopup.parentNode) {
            this.invitePopup.parentNode.removeChild(this.invitePopup);
            this.invitePopup = null;
        }
        if (this.statusTimer) {
            clearTimeout(this.statusTimer);
        }
        if (this.targetDummy && this.targetDummy.getData('respawnTimer')) {
            clearTimeout(this.targetDummy.getData('respawnTimer'));
        }
        if (this.socket) {
            this.socket.onmessage = null;
        }
        // Remove the fullscreen change listener to prevent memory leaks
        if (this.fullscreenChangeHandler) {
            document.removeEventListener('fullscreenchange', this.fullscreenChangeHandler);
        }
    }
}

class TowerScene extends Phaser.Scene {
    constructor() {
        super({ key: 'TowerScene' });
        this.partyLeader = null;
        this.fullscreenButton = null;
        this.attackType = 'ranged';
        this.clericTarget = null;
        this.justSetClericTarget = false;
        this.enemyProjectiles = null;
        this.selectionIndicator = null;
        this.safeZoneVisual = null;
        this.safeZoneText = null;
        this.fullscreenChangeHandler = null;
    }

    init(data) {
        this.isOffline = data.isOffline;
        this.socket = data.socket;
        this.playerName = data.playerName;
        this.playerClass = data.playerClass;
        this.roomName = data.roomName;
        this.partyLeader = data.partyLeader;
        
        this.playerSprites = {};
        this.towerEntities = {};
        this.playersData = data.players;
        this.initialTowerState = data.initialTowerState || generateTowerFloor(1);

        this.keys = null;
        this.projectiles = null;
        this.exitPortal = null;
        
        this.floorText = null;
        this.bossHealthBar = null;
        this.bossHealthText = null;
        this.statusText = null;
        this.partyListText = null;

        this.isTransitioning = false;
        this.currentTarget = null;
        this.clericTarget = null;
        this.justSetClericTarget = false;
        
        this.playerGroup = null;
        this.enemyGroup = null;

        if (this.playerClass === 'Paladin' || this.playerClass === 'Fighter') {
            this.attackType = 'melee';
        } else {
            this.attackType = 'ranged';
        }
    }

    preload() {
        this.load.image('towerFloor', 'https://www.breakingpointgames.com/play/WS/images/floor1.svg');
        this.load.image('minion', 'https://www.breakingpointgames.com/play/ws/images/minion_64px.png');
        this.load.image('boss', 'https://www.breakingpointgames.com/play/ws/images/boss_128px.png');
        this.load.image('portal', 'https://www.breakingpointgames.com/play/ws/images/portal_64px.png');
        this.load.image('paladin', 'https://www.breakingpointgames.com/play/ws/images/class_paladin.png');
        this.load.image('fighter', 'https://www.breakingpointgames.com/play/ws/images/class_fighter.png');
        this.load.image('cleric', 'https://www.breakingpointgames.com/play/ws/images/class_cleric.png');
        this.load.image('ranger', 'https://www.breakingpointgames.com/play/ws/images/class_ranger.png');
        this.load.image('selectionIndicator', 'https://www.breakingpointgames.com/play/ws/images/targetarrow_64px.png');
        this.load.image('aggroArrow', 'https://www.breakingpointgames.com/play/WS/images/aggroarrow_64px.png');

        // Preload selected state images
        this.load.image('selected_paladin', 'https://www.breakingpointgames.com/play/ws/images/selected_paladin.png');
        this.load.image('selected_fighter', 'https://www.breakingpointgames.com/play/ws/images/selected_fighter.png');
        this.load.image('selected_cleric', 'https://www.breakingpointgames.com/play/ws/images/selected_cleric.png');
        this.load.image('selected_ranger', 'https://www.breakingpointgames.com/play/ws/images/selected_ranger.png');

        const graphics = this.make.graphics();
        // Ranger Arrow
        graphics.fillStyle(0x84cc16, 1);
        graphics.lineStyle(2, 0x65a30d, 1);
        graphics.beginPath();
        graphics.moveTo(5, 0);
        graphics.lineTo(10, 5);
        graphics.lineTo(5, 10);
        graphics.closePath();
        graphics.fillPath();
        graphics.strokePath();
        graphics.generateTexture('arrow', 10, 10);
        graphics.clear();
        
        // Melee Slash
        graphics.lineStyle(4, 0xffff00, 0.8);
        graphics.beginPath();
        graphics.arc(32, 32, 28, Phaser.Math.DegToRad(220), Phaser.Math.DegToRad(320), false);
        graphics.strokePath();
        graphics.generateTexture('slash', 64, 64);
        graphics.clear();
        
        // Generic projectile & enemy projectile
        graphics.fillStyle(0xf97316, 1);
        graphics.fillCircle(4, 4, 4);
        graphics.generateTexture('projectile', 8, 8);
        graphics.clear();
        graphics.fillStyle(0xef4444, 1);
        graphics.fillCircle(6, 6, 6);
        graphics.generateTexture('enemy_projectile', 12, 12);
        graphics.clear();

        // Telegraph effect
        graphics.fillStyle(0xff0000, 0.5); // Semi-transparent red
        graphics.fillRect(0, 0, 80, 40); // A rectangle representing the attack area
        graphics.generateTexture('telegraph_rect', 80, 40);

        graphics.destroy();
    }

    create() {
        this.physics.world.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
        this.add.tileSprite(0, 0, WORLD_WIDTH, WORLD_HEIGHT, 'towerFloor').setOrigin(0, 0);

        this.keys = this.input.keyboard.addKeys('W,A,S,D');
        this.projectiles = this.physics.add.group({ defaultKey: 'projectile', maxSize: 100 });
        this.enemyProjectiles = this.physics.add.group({ defaultKey: 'enemy_projectile', maxSize: 50 });
        this.selectionIndicator = this.add.image(0, 0, 'selectionIndicator').setVisible(false).setDepth(20000);
        
        this.playerGroup = this.physics.add.group();
        this.enemyGroup = this.physics.add.group();

        this.playersData.forEach(p => {
            this.createPlayer(p.id, p.id === this.playerName, p.x, p.y, p.playerClass, p.health, p.maxHealth);
        });

        const localPlayer = this.playerSprites[this.playerName];
        if (localPlayer) {
            this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
            // Zoom out to see the whole map instead of following the player
            this.cameras.main.setZoom(0.5);
            this.cameras.main.centerOn(WORLD_WIDTH / 2, WORLD_HEIGHT / 2);
            this.physics.add.overlap(localPlayer, this.enemyProjectiles, this.onPlayerHitByProjectile, null, this);
        }

        this.createUI();
        this.loadFloor(this.initialTowerState);

        // Prevent players from colliding with enemies
        this.physics.add.collider(this.playerGroup, this.enemyGroup, null, () => false, this);

        if (!this.isOffline) {
            this.setupSocketListeners();
        }
        
        this.input.mouse.disableContextMenu();
        this.input.on('pointerdown', (pointer) => {
             if (this.justSetClericTarget) {
                this.justSetClericTarget = false;
                return;
             }
             
             // Right-click always clears any target
             if (pointer.rightButtonDown()) {
                this.clearTarget(); // For non-clerics
                this.setClericTarget(null); // For clerics
                return;
            }

            // --- Left-click logic ---
            if (pointer.leftButtonDown()) {
                // If I am a Cleric AND I have a target selected...
                if (this.playerClass === 'Cleric' && this.clericTarget) {
                    // ...heal the target, regardless of where I clicked.
                    if (!this.isOffline) {
                        this.socket.send(JSON.stringify({ type: 'heal_player', payload: { targetId: this.clericTarget.name } }));
                    }
                } 
                // If I am NOT a cleric AND I have a combat target...
                else if (this.playerClass !== 'Cleric' && this.currentTarget) {
                    // ...attack the target.
                    if (this.attackType === 'melee') {
                        this.performMeleeAttack();
                    } else {
                        this.shoot();
                    }
                } 
                // If I click on empty space (and I'm NOT a cleric with a target)...
                else if (!pointer.gameObject) {
                     // ...only non-clerics clear their target this way.
                    if (this.playerClass !== 'Cleric') {
                        this.clearTarget();
                    }
                }
            }
        });
        this.input.keyboard.on('keydown-ESC', () => {
            this.clearTarget();
            this.setClericTarget(null);
        }, this);

        this.events.on('shutdown', this.shutdown, this);
    }
    
    createPlayer(name, isLocal, x, y, playerClass, health, maxHealth) {
        if (this.playerSprites[name]) return;
    
        const playerContainer = this.add.container(x, y);
        playerContainer.setName(name);

        let imageKey;
        switch (playerClass) {
            case 'Paladin': imageKey = 'paladin'; break;
            case 'Fighter': imageKey = 'fighter'; break;
            case 'Cleric': imageKey = 'cleric'; break;
            case 'Ranger': imageKey = 'ranger'; break;
            default: imageKey = 'fighter'; break;
        }
    
        const playerSprite = this.add.image(0, 0, imageKey).setScale(0.25);
    
        const nameColor = isLocal ? '#f97316' : '#fff';
        const playerNameText = this.add.text(0, -72, name, { fontSize: '14px', color: nameColor }).setOrigin(0.5);
        
        const healthBar = this.add.graphics();
        playerContainer.add([playerSprite, playerNameText, healthBar]);
        this.physics.add.existing(playerContainer);
        playerContainer.body.setCollideWorldBounds(true);
        playerContainer.body.setSize(playerSprite.displayWidth, playerSprite.displayHeight);
        playerContainer.setDepth(10);
        
        playerContainer.setData({
            playerClass: playerClass,
            health: health,
            maxHealth: maxHealth,
            healthBar: healthBar
        });
        this.updatePlayerHealthBar(playerContainer);
        
        const interactiveArea = new Phaser.Geom.Rectangle(-playerSprite.displayWidth/2, -playerSprite.displayHeight/2, playerSprite.displayWidth, playerSprite.displayHeight);
        playerContainer.setInteractive(interactiveArea, Phaser.Geom.Rectangle.Contains);
        playerContainer.on('pointerdown', (pointer) => {
            if (pointer.leftButtonDown()) this.handlePlayerClick(playerContainer);
        });

        this.playerSprites[name] = playerContainer;
        this.playerGroup.add(playerContainer);
    }

    createUI() {
        this.floorText = this.add.text(this.cameras.main.width / 2, 30, `Floor ${this.initialTowerState.currentFloor}`, { fontSize: '24px', color: '#fff' }).setOrigin(0.5).setScrollFactor(0);

        this.add.text(10, 10, 'Leave Tower', { fontSize: '16px', color: '#ef4444', backgroundColor: '#111', padding: { x: 10, y: 5 } })
            .setInteractive({ useHandCursor: true })
            .on('pointerdown', () => this.leaveTower())
            .setScrollFactor(0);
        
        this.statusText = this.add.text(this.cameras.main.width/2, this.cameras.main.height - 30, '', {fontSize: '18px', color: '#f97316'}).setOrigin(0.5).setScrollFactor(0);

        this.fullscreenButton = this.add.text(this.cameras.main.width - 10, 10, '[ ]', { fontSize: '24px', fontStyle: 'bold', color: '#f97316', backgroundColor: '#111', padding: {x: 5, y:0}, align: 'center'})
            .setOrigin(1, 0)
            .setInteractive({ useHandCursor: true })
            .setScrollFactor(0);
        
        // Define a handler for fullscreen changes to avoid scope issues with 'this'
        this.fullscreenChangeHandler = () => {
            // Only update if this scene is still active
            if (!this.scene.isActive()) {
                return;
            }
            const rootEl = document.getElementById('root');
            if (this.fullscreenButton) {
                if (document.fullscreenElement === rootEl) {
                    this.fullscreenButton.setText('[X]');
                } else {
                    this.fullscreenButton.setText('[ ]');
                }
            }
        };
        // Add the event listener to the document
        document.addEventListener('fullscreenchange', this.fullscreenChangeHandler);

        // Handle button click using native Fullscreen API
        this.fullscreenButton.on('pointerdown', () => {
            const rootEl = document.getElementById('root');
            if (rootEl) {
                if (!document.fullscreenElement) {
                    rootEl.requestFullscreen().catch(err => {
                        console.error(`Error attempting to enable full-screen mode: ${err.message} (${err.name})`);
                    });
                } else {
                    if (document.exitFullscreen) {
                        document.exitFullscreen();
                    }
                }
            }
        });
    }

    loadFloor(towerState) {
        Object.values(this.towerEntities).forEach(entity => {
            const arrow = entity.getData('aggroArrow');
            if (arrow) arrow.destroy();
            entity.destroy();
        });
        this.towerEntities = {};

        // Draw safe zone visual
        if (!this.safeZoneVisual) {
            this.safeZoneVisual = this.add.graphics().setDepth(0);
            this.safeZoneText = this.add.text(WORLD_WIDTH / 2, WORLD_HEIGHT - 10, 'SAFE ZONE', {
                fontSize: '24px',
                color: '#ffffff',
                fontFamily: "'Bebas Neue', cursive",
                stroke: '#000000',
                strokeThickness: 4,
                alpha: 0.5
            }).setOrigin(0.5, 1).setDepth(1);
        }
        this.safeZoneVisual.clear();
        this.safeZoneVisual.fillStyle(0x22c55e, 0.15); // Semi-transparent green
        this.safeZoneVisual.fillRect(0, WORLD_HEIGHT - 200, WORLD_WIDTH, 200);

        this.floorText.setText(`Floor ${towerState.currentFloor}`);

        towerState.enemies.forEach(minion => this.createEntity(minion));
        this.createEntity(towerState.boss);

        if (this.exitPortal) this.exitPortal.destroy();
        this.exitPortal = this.physics.add.sprite(WORLD_WIDTH / 2, 150, 'portal').setVisible(false);
        this.exitPortal.body.setAllowGravity(false);
        this.exitPortal.body.setEnable(false); // Portal is intangible until activated.
        
        const localPlayer = this.playerSprites[this.playerName];
        if (localPlayer) {
             this.physics.add.overlap(localPlayer, this.exitPortal, this.onEnterExitPortal, null, this);
        }
    }
    
    createEntity(entityData) {
        const entity = this.physics.add.sprite(entityData.x, entityData.y, entityData.type).setInteractive({ useHandCursor: true });
        entity.setData(entityData);
        entity.body.setImmovable(true).setAllowGravity(false);
        entity.on('pointerdown', () => {
            if (this.playerClass === 'Cleric') {
                this.statusText.setText("Clerics can't attack enemies.");
                this.time.delayedCall(1500, () => this.statusText.setText(''));
            } else {
                this.setTarget(entity);
            }
        });
        
        const healthBar = this.add.graphics();
        entity.setData('healthBar', healthBar);
        this.updateHealthBar(entity);
        
        this.towerEntities[entityData.id] = entity;
        this.enemyGroup.add(entity);
        this.physics.add.overlap(entity, this.projectiles, this.handleProjectileHit, null, this);
    }

    setupSocketListeners() {
        this.socket.onmessage = (event) => {
            const message = JSON.parse(event.data);
            switch (message.type) {
                case 'move': this.updatePlayerPosition(message.payload); break;
                case 'leave': this.removePlayer(message.payload.id); break;
                case 'player_joined_tower_instance': this.addPlayerToTower(message.payload); break;
                case 'projectile_fired': this.spawnRemoteProjectile(message.payload); break;
                case 'melee_animation': this.playMeleeAnimation(message.payload.id, message.payload.angle); break;
                case 'tower_entity_update': this.handleEntityUpdate(message.payload); break;
                case 'player_healed': this.handlePlayerHealed(message.payload); break;
                case 'tower_floor_cleared': this.onFloorCleared(); break;
                case 'player_ready_update': this.onPlayerReadyUpdate(message.payload); break;
                case 'tower_load_next_floor': this.onNextFloor(message.payload); break;
                case 'tower_complete': this.onTowerComplete(); break;
                case 'return_to_hub': this.returnToHub(message.payload); break;
                // AI messages
                case 'enemy_move': this.handleEnemyMove(message.payload); break;
                case 'enemy_attack': this.handleEnemyAttack(message.payload); break;
                case 'enemy_telegraph_attack': this.handleEnemyTelegraph(message.payload); break;
                case 'player_damaged': this.handlePlayerDamaged(message.payload); break;
                case 'enemy_projectile_fired': this.handleEnemyProjectileFired(message.payload); break;
            }
        };

        this.socket.onclose = () => {
             if (this.scene.isActive()) this.scene.start('LobbyScene');
        };
    }

    update(time, delta) {
        const localPlayer = this.playerSprites[this.playerName];
        if (!localPlayer || !localPlayer.body || this.isTransitioning) return;
    
        const speed = 250;
        localPlayer.body.setVelocity(0);
        if (this.keys.A.isDown) localPlayer.body.setVelocityX(-speed);
        else if (this.keys.D.isDown) localPlayer.body.setVelocityX(speed);
        if (this.keys.W.isDown) localPlayer.body.setVelocityY(-speed);
        else if (this.keys.S.isDown) localPlayer.body.setVelocityY(speed);
        localPlayer.body.velocity.normalize().scale(speed);
    
        if (!this.isOffline && localPlayer.body.velocity.length() > 0) {
            this.socket.send(JSON.stringify({ type: 'move', payload: { id: this.playerName, x: localPlayer.x, y: localPlayer.y } }));
        }
    
        if (this.isOffline) {
            this.updateOfflineAI(time, delta);
        }
    
        // Depth Sorting
        Object.values(this.playerSprites).forEach(sprite => {
            if (sprite && sprite.active) sprite.setDepth(sprite.y);
        });
        Object.values(this.towerEntities).forEach(entity => {
            if (entity && entity.active) entity.setDepth(entity.y);
        });
    
        Object.values(this.towerEntities).forEach(this.updateHealthBar, this);

        // --- Target Indicator Logic ---
        if (this.selectionIndicator) {
            if (this.currentTarget && this.currentTarget.active && !this.currentTarget.getData('isDead')) {
                this.selectionIndicator.setVisible(true);
                const reticlePosY = this.currentTarget.y - (this.currentTarget.height / 2) - 10;
                this.selectionIndicator.setPosition(this.currentTarget.x, reticlePosY);
                this.selectionIndicator.setDepth(this.currentTarget.depth + 1);
            } else {
                this.selectionIndicator.setVisible(false);
            }
        }
        
        // --- Aggro Indicator Logic ---
        Object.values(this.towerEntities).forEach(entity => {
            if (!entity || !entity.active) return;
            
            const targetId = entity.getData('aggroTargetId');
            let arrow = entity.getData('aggroArrow');
            
            if (targetId) {
                const targetPlayer = this.playerSprites[targetId];
                if (targetPlayer && targetPlayer.active) {
                    if (!arrow) {
                        arrow = this.add.image(entity.x, entity.y, 'aggroArrow').setDepth(entity.depth + 1);
                        entity.setData('aggroArrow', arrow);
                    }
                    arrow.setVisible(true);
                    const arrowPosX = entity.x;
                    const arrowPosY = entity.y - (entity.height / 2) - 10;
                    const angle = Phaser.Math.Angle.Between(arrowPosX, arrowPosY, targetPlayer.x, targetPlayer.y);
                    arrow.setPosition(arrowPosX, arrowPosY);
                    arrow.setRotation(angle + Math.PI / 2);
                    arrow.setDepth(entity.depth + 1);
                } else if (arrow) {
                    arrow.setVisible(false);
                }
            } else if (arrow) {
                arrow.setVisible(false);
            }
        });
    }
    
    updateOfflineAI(time, delta) {
        const localPlayer = this.playerSprites[this.playerName];
        if (!localPlayer) return;
    
        const isPlayerSafe = localPlayer.y >= (WORLD_HEIGHT - 200);

        Object.values(this.towerEntities).forEach(entity => {
            if (entity.getData('isDead')) {
                if (entity.body) entity.body.setVelocity(0, 0);
                return;
            }

            if (isPlayerSafe) { // If player is safe, enemy does nothing.
                if (entity.body) entity.body.setVelocity(0, 0);
                return;
            }
    
            const now = time;
            const entityType = entity.getData('type');
    
            if (entityType === 'minion') {
                const MELEE_RANGE = 70;
                const MINION_SPEED = 150; // pixels per second
                const ATTACK_COOLDOWN = 2500;
                const DAMAGE = 10;
    
                const distance = Phaser.Math.Distance.Between(entity.x, entity.y, localPlayer.x, localPlayer.y);
                const telegraphEndTime = entity.getData('telegraphEndTime');
                const attackCooldown = entity.getData('attackCooldown') || 0;
    
                if (telegraphEndTime && now >= telegraphEndTime) {
                    entity.setData('telegraphEndTime', null);
                    entity.setData('attackCooldown', now + ATTACK_COOLDOWN);
    
                    const currentDistance = Phaser.Math.Distance.Between(entity.x, entity.y, localPlayer.x, localPlayer.y);
                    if (currentDistance <= MELEE_RANGE + 20) {
                        const newHealth = Math.max(0, localPlayer.getData('health') - DAMAGE);
                        this.handlePlayerDamaged({ id: this.playerName, newHealth });
                        this.handleEnemyAttack({ id: entity.getData('id') });
                    }
                } else if (distance > MELEE_RANGE && !telegraphEndTime) {
                    this.physics.moveToObject(entity, localPlayer, MINION_SPEED);
                } else if (distance <= MELEE_RANGE && now > attackCooldown && !telegraphEndTime) {
                    entity.body.setVelocity(0, 0);
                    entity.setData('telegraphEndTime', now + 500);
    
                    const angle = Phaser.Math.Angle.Between(entity.x, entity.y, localPlayer.x, localPlayer.y);
                    const telegraphDist = 40;
                    const telegraphX = entity.x + Math.cos(angle) * telegraphDist;
                    const telegraphY = entity.y + Math.sin(angle) * telegraphDist;
    
                    this.handleEnemyTelegraph({
                        id: entity.getData('id'),
                        x: telegraphX,
                        y: telegraphY,
                        angle: angle
                    });
                } else if (distance <= MELEE_RANGE && !telegraphEndTime) {
                    entity.body.setVelocity(0, 0);
                }
            } else if (entityType === 'boss') {
                const ATTACK_COOLDOWN = 3000;
                const PROJECTILE_SPEED = 400;
                const attackCooldown = entity.getData('attackCooldown') || 0;
    
                if (now > attackCooldown) {
                    entity.setData('attackCooldown', now + ATTACK_COOLDOWN);
                    const attackCounter = (entity.getData('attackCounter') || 0) + 1;
                    entity.setData('attackCounter', attackCounter);
    
                    const angle = Phaser.Math.Angle.Between(entity.x, entity.y, localPlayer.x, localPlayer.y);
    
                    if (attackCounter % 3 === 0) {
                        const spread = 0.25; // Radians
                        const angles = [angle - spread, angle, angle + spread];
                        angles.forEach(shotAngle => {
                            const vx = Math.cos(shotAngle) * PROJECTILE_SPEED;
                            const vy = Math.sin(shotAngle) * PROJECTILE_SPEED;
                            this.handleEnemyProjectileFired({ x: entity.x, y: entity.y, vx, vy });
                        });
                    } else {
                        const vx = Math.cos(angle) * PROJECTILE_SPEED;
                        const vy = Math.sin(angle) * PROJECTILE_SPEED;
                        this.handleEnemyProjectileFired({ x: entity.x, y: entity.y, vx, vy });
                    }
                }
            }
        });
    }

    updatePlayerPosition(data) {
        const sprite = this.playerSprites[data.id];
        if (sprite) {
             this.tweens.add({ targets: sprite, x: data.x, y: data.y, duration: 50, ease: 'Linear' });
        }
    }
    
    performMeleeAttack() {
        if (!this.currentTarget || !this.currentTarget.active) {
            this.clearTarget();
            return;
        }
        if (this.attackType !== 'melee') {
            this.statusText.setText("You can't attack up close!");
            this.time.delayedCall(1000, () => this.statusText.setText(''));
            return;
        }
    
        const localPlayer = this.playerSprites[this.playerName];
        const MELEE_RANGE = 100;
        const distance = Phaser.Math.Distance.Between(localPlayer.x, localPlayer.y, this.currentTarget.x, this.currentTarget.y);
    
        if (distance > MELEE_RANGE) {
            this.statusText.setText('Target is too far away!');
            this.time.delayedCall(1000, () => this.statusText.setText(''));
            return;
        }
    
        const angle = Phaser.Math.Angle.Between(localPlayer.x, localPlayer.y, this.currentTarget.x, this.currentTarget.y);
        this.playMeleeAnimation(this.playerName, angle);
        
        const targetId = this.currentTarget.getData('id');
        if (this.isOffline) {
            const damage = { Paladin: 80, Fighter: 120, Ranger: 110 }[this.playerClass] || 100;
            let health = this.currentTarget.getData('health') - damage;
            const isDead = health <= 0;
            this.handleEntityUpdate({ id: targetId, health: Math.max(0, health), isDead });
            if (isDead) this.checkFloorCleared();
        } else {
            this.socket.send(JSON.stringify({ type: 'melee_animation', payload: { id: this.playerName, angle: angle } }));
            this.socket.send(JSON.stringify({ type: 'hit_tower_entity', payload: { entityId: targetId } }));
        }
    }
    
    playMeleeAnimation(playerId, angle) {
        const playerSpriteContainer = this.playerSprites[playerId];
        if (!playerSpriteContainer || playerSpriteContainer.getData('isAttacking')) return;
    
        playerSpriteContainer.setData('isAttacking', true);

        const distance = 40; // How far in front of the player
        const slashX = playerSpriteContainer.x + Math.cos(angle) * distance;
        const slashY = playerSpriteContainer.y + Math.sin(angle) * distance;

        const slash = this.add.image(slashX, slashY, 'slash').setRotation(angle + Math.PI / 2).setDepth(playerSpriteContainer.depth + 1);
        
        this.tweens.add({
            targets: slash,
            alpha: 0,
            duration: 250,
            ease: 'Cubic.easeOut',
            onComplete: () => {
                slash.destroy();
            }
        });
    
        this.time.delayedCall(150, () => {
            if (playerSpriteContainer && playerSpriteContainer.active) {
                playerSpriteContainer.setData('isAttacking', false);
            }
        });
    }

    shoot() {
        if (this.attackType !== 'ranged') {
            this.statusText.setText("You can't attack from range!");
            this.time.delayedCall(1000, () => this.statusText.setText(''));
            return;
        }
        if (!this.currentTarget || !this.currentTarget.active) {
            this.clearTarget();
            return;
        }
        const localPlayer = this.playerSprites[this.playerName];
        const projectileTexture = this.playerClass === 'Ranger' ? 'arrow' : 'projectile';
        const projectile = this.projectiles.get(localPlayer.x, localPlayer.y, projectileTexture);

        if (projectile) {
            const angle = Phaser.Math.Angle.Between(localPlayer.x, localPlayer.y, this.currentTarget.x, this.currentTarget.y);
            projectile.setRotation(angle + Math.PI / 2);
            projectile.setData('owner', this.playerName);
            projectile.setData('hasHit', false);
            projectile.setActive(true).setVisible(true);
            this.physics.moveToObject(projectile, this.currentTarget, 600);
            if (!this.isOffline) {
                 this.socket.send(JSON.stringify({
                    type: 'shoot',
                    payload: { 
                        x: projectile.x, 
                        y: projectile.y, 
                        velocityX: projectile.body.velocity.x, 
                        velocityY: projectile.body.velocity.y,
                        rotation: projectile.rotation
                    }
                }));
            }
        }
    }
    
    spawnRemoteProjectile(data) {
        const texture = data.playerClass === 'Ranger' ? 'arrow' : 'projectile';
        const projectile = this.projectiles.get(data.x, data.y, texture);
        if (projectile) {
            projectile.setRotation(data.rotation);
            projectile.setData('owner', data.id).setData('hasHit', false);
            projectile.setActive(true).setVisible(true);
            projectile.body.setVelocity(data.velocityX, data.velocityY);
        }
    }

    handleProjectileHit(entity, projectile) {
        if (projectile.getData('hasHit') || entity.getData('isDead')) return;
        
        projectile.setData('hasHit', true);
        this.projectiles.killAndHide(projectile);
        projectile.body.stop();

        if (this.isOffline) {
            const damage = { Paladin: 80, Fighter: 120, Ranger: 110 }[this.playerClass] || 100;
            let health = entity.getData('health') - damage;
            const isDead = health <= 0;
            this.handleEntityUpdate({ id: entity.getData('id'), health: Math.max(0, health), isDead });
            if (isDead) this.checkFloorCleared();
        } else {
            if (projectile.getData('owner') === this.playerName) {
                this.socket.send(JSON.stringify({ type: 'hit_tower_entity', payload: { entityId: entity.getData('id') } }));
            }
        }
    }

    handleEntityUpdate(data) {
        const entity = this.towerEntities[data.id];
        if (entity) {
            entity.setData('health', data.health);
            entity.setData('isDead', data.isDead);
            if (data.isDead) {
                this.tweens.add({ targets: entity, alpha: 0, duration: 300, onComplete: () => entity.setVisible(false) });
                if (this.currentTarget === entity) this.clearTarget();
            }
        }
    }
    
    updatePlayerHealthBar(playerContainer) {
        const healthBar = playerContainer.getData('healthBar');
        const health = playerContainer.getData('health');
        const maxHealth = playerContainer.getData('maxHealth');
        if (!healthBar || typeof health === 'undefined' || typeof maxHealth === 'undefined') return;

        healthBar.clear();
        if (health <= 0) return;

        const barWidth = 40;
        const barHeight = 5;
        const x = -barWidth / 2;
        const y = -60;

        healthBar.fillStyle(0x000000, 0.7);
        healthBar.fillRect(x, y, barWidth, barHeight);

        const healthPercentage = health / maxHealth;
        if (healthPercentage > 0) {
            healthBar.fillStyle(0x22c55e, 1);
            healthBar.fillRect(x, y, barWidth * healthPercentage, barHeight);
        }
    }

    handlePlayerClick(targetContainer) {
        if (this.playerClass !== 'Cleric') return;

        // This function now ONLY sets the target. Healing is handled by the global click handler.
        this.setClericTarget(targetContainer);
        this.justSetClericTarget = true; // Prevents the global handler from firing on this same click.
    }

    setClericTarget(targetContainer) {
        // Deselect the old target if it exists by reverting its texture
        if (this.clericTarget && this.clericTarget.getData('originalTexture')) {
            const oldSprite = this.clericTarget.list[0];
            const originalTexture = this.clericTarget.getData('originalTexture');
            if (oldSprite && originalTexture) {
                oldSprite.setTexture(originalTexture);
            }
            this.clericTarget.setData('originalTexture', null);
        }
    
        this.clericTarget = targetContainer;
    
        // Select the new target if it exists by swapping its texture
        if (this.clericTarget) {
            const newSprite = this.clericTarget.list[0]; // The actual image sprite is the first element
            const playerClass = this.clericTarget.getData('playerClass');
            
            if (newSprite && playerClass) {
                // Store the original texture before changing it
                this.clericTarget.setData('originalTexture', newSprite.texture.key);
    
                let selectedTextureKey;
                switch(playerClass) {
                    case 'Paladin': selectedTextureKey = 'selected_paladin'; break;
                    case 'Fighter': selectedTextureKey = 'selected_fighter'; break;
                    case 'Cleric': selectedTextureKey = 'selected_cleric'; break;
                    case 'Ranger': selectedTextureKey = 'selected_ranger'; break;
                }
    
                if (selectedTextureKey) {
                    newSprite.setTexture(selectedTextureKey);
                }
            }
        }
    }

    handlePlayerHealed(payload) {
        const { targetId, newHealth } = payload;
        const targetSprite = this.playerSprites[targetId];
        if (targetSprite) {
            targetSprite.setData('health', newHealth);
            this.updatePlayerHealthBar(targetSprite);
            
            const spriteImage = targetSprite.list[0];
            if (spriteImage) {
                 // This tween configuration is robust against rapid firing.
                // It applies a green tint and uses yoyo to fade back.
                // The onComplete callback is a safeguard to ensure the tint is cleared.
                this.tweens.add({
                    targets: spriteImage,
                    tint: 0x22c55e,
                    duration: 200,
                    yoyo: true,
                    onComplete: () => {
                        if (spriteImage && spriteImage.active) {
                            spriteImage.clearTint();
                        }
                    }
                });
            }
        }
    }
    
    updateHealthBar(entity) {
        const healthBar = entity.getData('healthBar');
        if (!healthBar) return;
        healthBar.clear();
        if (entity.getData('isDead')) return;

        const health = entity.getData('health');
        const maxHealth = entity.getData('maxHealth');
        const barWidth = entity.width * 0.8;
        const barHeight = 8;
        const x = entity.x - barWidth / 2;
        const y = entity.y + entity.height / 2 + 5;

        healthBar.fillStyle(0x000000, 0.5);
        healthBar.fillRect(x, y, barWidth, barHeight);
        healthBar.fillStyle(0xef4444, 1);
        healthBar.fillRect(x, y, barWidth * (health/maxHealth), barHeight);
    }
    
    onFloorCleared() {
        this.statusText.setText('Floor Cleared! Portal is now active.');
        this.exitPortal.setVisible(true);
        this.exitPortal.body.setEnable(true); // Activate the portal's physics.
    }

    checkFloorCleared() { // Offline mode helper
        const allDead = Object.values(this.towerEntities).every(e => e.getData('isDead'));
        if(allDead) this.onFloorCleared();
    }
    
    onEnterExitPortal() {
        if (this.isTransitioning || !this.exitPortal.visible) return;
        this.isTransitioning = true; // Prevents sending multiple requests
        
        const localPlayer = this.playerSprites[this.playerName];
        localPlayer.body.setEnable(false); // Stop movement
        
        if (this.isOffline) {
            const currentFloor = this.initialTowerState.currentFloor;
            if (currentFloor >= 10) {
                 this.onTowerComplete();
            } else {
                 this.onNextFloor({ towerState: generateTowerFloor(currentFloor + 1) });
            }
        } else {
            this.socket.send(JSON.stringify({ type: 'request_next_floor' }));
            this.statusText.setText('Waiting for other players...');
        }
    }

    onPlayerReadyUpdate(data) {
        const { readyCount, totalCount, player } = data;
        if (player === this.playerName) {
            this.statusText.setText(`Waiting for party... (${readyCount}/${totalCount} ready)`);
        } else {
            // Can add a less intrusive notification for other players getting ready if desired
        }
    }

    onNextFloor(data) {
        this.isTransitioning = false;
        const localPlayer = this.playerSprites[this.playerName];
        if (localPlayer && localPlayer.body) localPlayer.body.setEnable(true);

        this.loadFloor(data.towerState);
        this.statusText.setText('');
        
        // Reposition players
        const positions = data.playerPositions || [{ id: this.playerName, x: WORLD_WIDTH / 2, y: WORLD_HEIGHT - 100 }];
        positions.forEach(p => {
            const sprite = this.playerSprites[p.id];
            if (sprite) {
                sprite.setPosition(p.x, p.y);
            }
        });
    }

    onTowerComplete() {
        this.statusText.setText('Congratulations! Tower Complete!');
        setTimeout(() => this.leaveTower(), 3000);
    }

    leaveTower() {
        if (this.isOffline) {
            this.scene.start('GameScene', { isOffline: true, playerName: this.playerName, playerClass: this.playerClass });
        } else {
            this.socket.send(JSON.stringify({ type: 'leave_tower' }));
        }
    }
    
    returnToHub(data) {
        this.scene.start('GameScene', {
            socket: this.socket,
            playerName: this.playerName,
            playerClass: this.playerClass,
            roomName: this.roomName,
            leader: data.leader,
            onlinePlayers: data.onlinePlayers,
            players: data.players,
            dummyHealth: data.dummyHealth,
            currentTarget: data.currentTarget
        });
    }

    addPlayerToTower(data) {
        this.createPlayer(data.id, false, data.x, data.y, data.playerClass, data.health, data.maxHealth);
    }

    removePlayer(id) {
        const sprite = this.playerSprites[id];
        if (sprite) sprite.destroy();
        delete this.playerSprites[id];
    }
    
    setTarget(target) {
        this.clearTarget();
        this.currentTarget = target;
        // The visual indicator is now handled in the update loop.
    }

    clearTarget() {
        this.currentTarget = null;
        // The visual indicator is now handled in the update loop.
    }
    
    // --- AI Message Handlers ---
    handleEnemyMove(data) {
        const entity = this.towerEntities[data.id];
        if (entity) {
            entity.setData('aggroTargetId', data.targetId); // Store the aggro target
            this.tweens.add({
                targets: entity,
                x: data.x,
                y: data.y,
                duration: 200, // Corresponds to game tick rate
                ease: 'Linear'
            });
        }
    }
    
    handleEnemyAttack(data) {
        const entity = this.towerEntities[data.id];
        if (entity) {
            this.tweens.add({
                targets: entity,
                scaleX: 1.2,
                scaleY: 1.2,
                yoyo: true,
                duration: 100,
                ease: 'Cubic.easeInOut'
            });
        }
    }

    handleEnemyTelegraph(data) {
        const { x, y, angle, id } = data;

        const telegraphSprite = this.add.sprite(x, y, 'telegraph_rect')
            .setRotation(angle)
            .setAlpha(0); // Start invisible
        
        const minion = this.towerEntities[id];
        if (minion) {
            telegraphSprite.setDepth(minion.depth - 1); // Appear under the minion
        }

        this.tweens.add({
            targets: telegraphSprite,
            alpha: 1,
            duration: 100, // Fade in
            yoyo: true, // Fade out
            hold: 300, // Hold at full alpha for 300ms (total duration 500ms)
            onComplete: () => {
                telegraphSprite.destroy();
            }
        });
    }

    handlePlayerDamaged(data) {
        const playerSprite = this.playerSprites[data.id];
        if (playerSprite) {
            playerSprite.setData('health', data.newHealth);
            this.updatePlayerHealthBar(playerSprite);
            if (data.id === this.playerName) {
                this.cameras.main.flash(100, 255, 0, 0);
            }
        }
    }
    
    handleEnemyProjectileFired(data) {
        const proj = this.enemyProjectiles.get(data.x, data.y, 'enemy_projectile');
        if (proj) {
            proj.setActive(true).setVisible(true);
            proj.body.setVelocity(data.vx, data.vy);
        }
    }

    onPlayerHitByProjectile(player, projectile) {
        // The visual effect is immediate, but the health update comes from the server
        projectile.destroy();
    }
    
    shutdown() {
        if(this.socket) this.socket.onmessage = null;
        if (this.safeZoneVisual) this.safeZoneVisual.destroy();
        if (this.safeZoneText) this.safeZoneText.destroy();
        this.safeZoneVisual = null;
        this.safeZoneText = null;
        // Remove the fullscreen change listener to prevent memory leaks
        if (this.fullscreenChangeHandler) {
            document.removeEventListener('fullscreenchange', this.fullscreenChangeHandler);
        }
    }
}

const config = {
    type: Phaser.AUTO,
    parent: 'root',
    width: LOBBY_WIDTH,
    height: LOBBY_HEIGHT,
    physics: {
        default: 'arcade',
        arcade: {
            gravity: { y: 0 },
            debug: false
        }
    },
    dom: {
        createContainer: true
    },
    scene: [LobbyScene, ClassSelectionScene, GameScene, TowerScene],
    scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH
    }
};

const game = new Phaser.Game(config);
