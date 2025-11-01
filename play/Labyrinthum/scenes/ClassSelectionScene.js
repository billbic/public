
import { CLASS_HEALTH, WORLD_WIDTH, WORLD_HEIGHT } from '../utils.js';

export default class ClassSelectionScene extends Phaser.Scene {
    constructor() {
        super({ key: 'ClassSelectionScene' });
        this.socketManager = null;
        this.lobbyData = {};
        this.isOffline = false;
    }

    init(data) {
        this.socketManager = data.socketManager;
        this.lobbyData = data;
        this.isOffline = data.isOffline;
    }

    preload() {
        this.load.setPath('play/isotower/');
        this.load.image('paladin', 'https://www.breakingpointgames.com/play/isotower/images/class_paladin.png');
        this.load.image('fighter', 'https://www.breakingpointgames.com/play/isotower/images/class_fighter.png');
        this.load.image('cleric', 'https://www.breakingpointgames.com/play/isotower/images/class_cleric.png');
        this.load.image('ranger', 'https://www.breakingpointgames.com/play/isotower/images/class_ranger.png');
    }

    create() {
        this.add.text(this.cameras.main.width / 2, 80, 'Choose Your Class', { 
            fontSize: '48px', color: '#f97316', fontFamily: "'Bebas Neue', cursive",
            stroke: '#000', strokeThickness: 2
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

        const backButton = this.add.text(120, 50, 'Back to Menu', { 
            fontSize: '24px', color: '#ccc', fontFamily: "'Bebas Neue', cursive",
            backgroundColor: '#333', padding: { x: 15, y: 8 },
        }).setOrigin(0.5).setInteractive({ useHandCursor: true });

        backButton.on('pointerdown', () => {
            if (this.socketManager) {
                this.socketManager.close();
            }
            this.scene.start('LobbyScene');
        });

        backButton.on('pointerover', () => backButton.setStyle({ backgroundColor: '#555' }));
        backButton.on('pointerout', () => backButton.setStyle({ backgroundColor: '#333' }));
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
        const health = CLASS_HEALTH[className] || 100;

        if (this.isOffline) {
            this.scene.start('GameScene', {
                isOffline: true,
                playerName: this.lobbyData.playerName,
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
        } else {
            this.socketManager.sendMessage('class_selected', { playerClass: className });
            
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