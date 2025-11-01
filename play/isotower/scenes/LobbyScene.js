
import SocketManager from '../managers/SocketManager.js';
import AssetManager from '../managers/AssetManager.js';
import { LOBBY_WIDTH, LOBBY_HEIGHT } from '../utils.js';

export default class LobbyScene extends Phaser.Scene {
    constructor() {
        super({ key: 'LobbyScene' });
        this.socketManager = null;
        this.playerName = '';
        this.isGuest = true;
        this.statusText = null;
        this.connectButton = null;
        this.offlineButton = null;
    }

    preload() {
        this.load.setPath('play/isotower/');
        // Preload assets needed for this scene
        AssetManager.preload(this);
    }
    
    create() {
        // REMOVED: The in-game background is no longer needed as the canvas is transparent.
        // this.add.tileSprite(LOBBY_WIDTH / 2, LOBBY_HEIGHT / 2, LOBBY_WIDTH, LOBBY_HEIGHT, 'floor1').setDepth(-1000);

        this.connectButton = this.add.text(this.cameras.main.width / 2, this.cameras.main.height / 2 - 40, 'Connect Online', { 
            fontSize: '32px', color: '#121212', fontFamily: "'Bebas Neue', cursive",
            backgroundColor: '#f97316', padding: { x: 40, y: 10 },
        }).setOrigin(0.5).setInteractive({ useHandCursor: true });
        
        this.offlineButton = this.add.text(this.cameras.main.width / 2, this.cameras.main.height / 2 + 40, 'Play Offline (Test)', { 
            fontSize: '24px', color: '#ccc', fontFamily: "'Bebas Neue', cursive",
            backgroundColor: '#333', padding: { x: 20, y: 8 },
        }).setOrigin(0.5).setInteractive({ useHandCursor: true });
        
        this.statusText = this.add.text(this.cameras.main.width / 2, this.cameras.main.height - 50, '', { fontSize: '24px', color: '#fff', fontStyle: 'italic', align: 'center' }).setOrigin(0.5);
        
        this.connectButton.on('pointerdown', () => {
            this.connectButton.setVisible(false);
            this.offlineButton.setVisible(false);
            this.statusText.setText('Initializing...');
            this.determinePlayerIdentity();
            this.setupAndConnectSocket();
        });
        
        this.offlineButton.on('pointerdown', () => {
            console.log("Starting offline mode.");
            this.scene.start('ClassSelectionScene', { isOffline: true, playerName: 'LocalTester' });
        });

        this.connectButton.on('pointerover', () => this.connectButton.setStyle({ backgroundColor: '#fb923c', color: '#121212' }));
        this.connectButton.on('pointerout', () => this.connectButton.setStyle({ backgroundColor: '#f97316', color: '#121212' }));
        this.offlineButton.on('pointerover', () => this.offlineButton.setStyle({ backgroundColor: '#555' }));
        this.offlineButton.on('pointerout', () => this.offlineButton.setStyle({ backgroundColor: '#333' }));
        
        this.events.on('shutdown', this.shutdown, this);
    }
    
    determinePlayerIdentity() {
        const loggedInUsername = document.body.dataset.username;
        if (loggedInUsername) {
            this.playerName = loggedInUsername;
            this.isGuest = false;
        } else {
            this.isGuest = true;
            this.playerName = 'Guest'; 
        }
    }

    setupAndConnectSocket() {
        this.statusText.setText('Connecting to the world...');
        this.socketManager = new SocketManager();

        this.socketManager.on('open', () => {
            console.log('WebSocket connection established.');
            this.statusText.setText('Authenticating...');
            this.socketManager.sendMessage('auth', { username: this.playerName, isGuest: this.isGuest });
        });

        this.socketManager.on('message', (message) => {
            switch (message.type) {
                case 'auth_success':
                    this.scene.start('ClassSelectionScene', {
                        socketManager: this.socketManager,
                        playerName: message.payload.id,
                        roomName: message.payload.room,
                        ...message.payload
                    });
                    break;
                case 'error':
                     this.statusText.setText(`Error: ${message.payload}`);
                     this.socketManager.close();
                     if (this.connectButton) this.connectButton.setVisible(true);
                     if (this.offlineButton) this.offlineButton.setVisible(true);
                     break;
            }
        });

        this.socketManager.on('error', (event) => {
            this.statusText.setText('Connection error. Please try again.');
            console.error('WebSocket Error Event:', event);
            if (this.connectButton) this.connectButton.setVisible(true);
            if (this.offlineButton) this.offlineButton.setVisible(true);
        });
        
        this.socketManager.on('close', (event) => {
             if (this.scene.isActive()) {
                console.log(`WebSocket closed. Code: ${event.code}, Reason: ${event.reason}`);
                this.statusText.setText('Connection closed or failed. Please try again.');
                if (this.connectButton) this.connectButton.setVisible(true);
                if (this.offlineButton) this.offlineButton.setVisible(true);
             }
        });

        this.socketManager.connect();
    }

    shutdown() {
        if (this.socketManager) {
            this.socketManager.close();
            this.socketManager = null;
        }
    }
}