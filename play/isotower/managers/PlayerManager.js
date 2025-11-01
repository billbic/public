

export default class PlayerManager {
    constructor(scene) {
        this.scene = scene;
        this.playerSprites = {}; // { name: sprite }
        this.playerGroup = this.scene.physics.add.group({
            collideWorldBounds: true
        });
    }

    getLocalPlayer() {
        return this.playerSprites[this.scene.playerData.name];
    }

    getPlayer(name) {
        return this.playerSprites[name];
    }
    
    getPlayers() {
        return this.playerSprites;
    }

    createPlayer(name, isLocal, x, y, playerClass, health, maxHealth) {
        if (this.playerSprites[name]) return;

        const container = this.scene.add.container(x, y);
        container.setName(name);

        const imageKey = playerClass.toLowerCase();
        const sprite = this.scene.add.image(0, 0, imageKey).setScale(0.5, 0.3);
        const nameColor = isLocal ? '#f97316' : '#fff';
        const nameText = this.scene.add.text(0, -105, name, { fontSize: '14px', color: nameColor }).setOrigin(0.5);
        const healthBar = this.scene.add.graphics();
        
        container.add([sprite, nameText, healthBar]);
        this.scene.physics.add.existing(container);

        const bodyWidth = sprite.displayWidth * 0.4;
        const bodyHeight = sprite.displayHeight * 0.3;
        container.body.setSize(bodyWidth, bodyHeight).setOffset(-bodyWidth / 2, sprite.displayHeight * 0.5 - bodyHeight);

        container.setData({ playerClass, health, maxHealth, healthBar, isInvincible: false });
        this.updatePlayerHealthBar(container);

        const interactiveArea = new Phaser.Geom.Rectangle(-sprite.displayWidth/2, -sprite.displayHeight/2, sprite.displayWidth, sprite.displayHeight);
        container.setInteractive(interactiveArea, Phaser.Geom.Rectangle.Contains);
        container.on('pointerdown', () => this.scene.inputManager.handleTargetClick(container));

        this.playerSprites[name] = container;
        this.playerGroup.add(container);
    }

    removePlayer(id) {
        const sprite = this.playerSprites[id];
        if (sprite) {
            this.scene.uiManager.displayStatusMessage(`${id} left the party.`);
            sprite.destroy();
            delete this.playerSprites[id];
        }
    }

    updatePlayerPosition(data) {
        const sprite = this.playerSprites[data.id];
        if (sprite && data.id !== this.scene.playerData.name) {
            this.scene.tweens.add({ targets: sprite, x: data.x, y: data.y, duration: 50, ease: 'Linear' });
        }
    }

    update(keys) {
        const localPlayer = this.getLocalPlayer();
        if (!localPlayer || !localPlayer.body || this.scene.uiManager.isConsoleOpen) {
            // FIX: Added optional chaining to prevent a crash if localPlayer is null
            // when the console is opened or during a scene transition.
            localPlayer?.body?.setVelocity(0, 0);
            return;
        };

        const speed = 250;
        let inputVector = new Phaser.Math.Vector2(0, 0);

        if (keys.W.isDown) inputVector.y = -1;
        if (keys.S.isDown) inputVector.y = 1;
        if (keys.A.isDown) inputVector.x = -1;
        if (keys.D.isDown) inputVector.x = 1;

        inputVector.normalize();
        localPlayer.body.setVelocity(inputVector.x * speed, inputVector.y * speed);

        if (!this.scene.isOffline && localPlayer.body.velocity.length() > 0) {
            this.scene.socketManager.sendMessage('move', {
                id: this.scene.playerData.name,
                x: localPlayer.x,
                y: localPlayer.y,
            });
        }
    }
    
    updatePartyState(data) {
        this.scene.playerData.room = data.room;
        this.scene.playerData.leader = data.leader;

        const currentSpriteNames = new Set(Object.keys(this.playerSprites));
        const newSpriteNames = new Set(data.players.map(p => p.id));

        for (const name of currentSpriteNames) {
            if (!newSpriteNames.has(name) && name !== this.scene.playerData.name) {
                this.removePlayer(name);
            }
        }

        data.players.forEach(p => {
            if (!this.playerSprites[p.id]) {
                this.createPlayer(p.id, p.id === this.scene.playerData.name, p.x, p.y, p.playerClass, p.health, p.maxHealth);
            }
        });
        
        if (this.scene.enemyManager.targetDummy) {
            if (typeof data.dummyHealth !== 'undefined') {
                this.scene.enemyManager.handleDummyHealthUpdate({ health: data.dummyHealth });
            }
            this.scene.enemyManager.updateDummyAggro(data.currentTarget || null);
        }
    }
    
    repositionPlayers(positions) {
        positions.forEach(p => {
            const sprite = this.playerSprites[p.id];
            if (sprite) {
                sprite.setPosition(p.x, p.y);
            }
        });
    }

    // --- Health & Cleric Logic ---

    updatePlayerHealthBar(container) {
        const { healthBar, health, maxHealth } = container.data.getAll();
        if (!healthBar || typeof health === 'undefined') return;

        healthBar.clear();
        if (health <= 0) return;

        const barWidth = 40;
        const barHeight = 5;
        const x = -barWidth / 2;
        const y = -95;

        healthBar.fillStyle(0x000000, 0.7);
        healthBar.fillRect(x, y, barWidth, barHeight);
        
        const healthPercentage = health / maxHealth;
        if (healthPercentage > 0) {
            healthBar.fillStyle(0x22c55e, 1);
            healthBar.fillRect(x, y, barWidth * healthPercentage, barHeight);
        }
    }
    
    handlePlayerHealed(payload) {
        const targetSprite = this.playerSprites[payload.targetId];
        if (targetSprite) {
            targetSprite.setData('health', payload.newHealth);
            this.updatePlayerHealthBar(targetSprite);
            
            const spriteImage = targetSprite.list[0];
            if (spriteImage) {
                this.scene.tweens.add({
                    targets: spriteImage, tint: 0x22c55e, duration: 200, yoyo: true,
                    onComplete: () => spriteImage.active && spriteImage.clearTint()
                });
            }
        }
    }

    handlePlayerDamaged(data) {
        const playerSprite = this.playerSprites[data.id];
        if (playerSprite) {
            if (data.id === this.scene.playerData.name && playerSprite.getData('isInvincible')) {
                return; // Ignore damage if invincible
            }
            playerSprite.setData('health', data.newHealth);
            this.updatePlayerHealthBar(playerSprite);
            if (data.id === this.scene.playerData.name) {
                this.scene.cameras.main.flash(100, 255, 0, 0);
            }
        }
    }

    selectClericTarget(target) {
        if (target.getData('playerClass')) {
            const sprite = target.list[0];
            const playerClass = target.getData('playerClass');
            if (sprite && playerClass) {
                target.setData('originalTexture', sprite.texture.key);
                sprite.setTexture(`selected_${playerClass.toLowerCase()}`);
            }
        } else {
            target.setTint(0x22c55e);
        }
    }

    deselectClericTarget(target) {
        if (target.getData('playerClass')) {
            const sprite = target.list[0];
            const originalTexture = target.getData('originalTexture');
            if (sprite && originalTexture) {
                sprite.setTexture(originalTexture);
            }
            target.setData('originalTexture', null);
        } else {
            target.clearTint();
        }
    }

    // --- Attack Logic ---

    performAttack() {
        if (!this.scene.inputManager.currentTarget || !this.scene.inputManager.currentTarget.active) {
            this.scene.inputManager.clearTarget();
            return;
        }

        if (this.scene.attackType === 'melee') {
            this.performMeleeAttack();
        } else {
            this.performRangedAttack();
        }
    }

    performMeleeAttack() {
        const localPlayer = this.getLocalPlayer();
        const target = this.scene.inputManager.currentTarget;
        const MELEE_RANGE = 100;

        const distance = Phaser.Math.Distance.Between(
            localPlayer.body.center.x,
            localPlayer.body.center.y,
            target.body.center.x,
            target.body.center.y
        );

        if (distance > MELEE_RANGE) {
            this.scene.uiManager.displayStatusMessage('Target is too far away!', 1000);
            return;
        }

        const angle = Phaser.Math.Angle.Between(localPlayer.x, localPlayer.y, target.x, target.y);
        this.playMeleeAnimation(this.scene.playerData.name, angle);
        
        if (!this.scene.isOffline) {
            this.scene.socketManager.sendMessage('melee_animation', { id: this.scene.playerData.name, angle: angle });
        }
        
        if (this.scene.constructor.name === 'GameScene') {
            if (this.scene.isOffline) {
                this.scene.enemyManager.handleLocalDummyHit();
            } else {
                this.scene.socketManager.sendMessage('dummy_hit');
            }
        } else { // TowerScene
             if (this.scene.isOffline) {
                this.scene.enemyManager.handleLocalEntityHit(target);
            } else {
                this.scene.socketManager.sendMessage('hit_tower_entity', { entityId: target.getData('id') });
            }
        }
    }

    playMeleeAnimation(playerId, angle) {
        const playerContainer = this.playerSprites[playerId];
        if (!playerContainer || playerContainer.getData('isAttacking')) return;
    
        playerContainer.setData('isAttacking', true);
        
        const slash = this.scene.add.image(playerContainer.x + Math.cos(angle) * 40, playerContainer.y + Math.sin(angle) * 40, 'slash')
            .setRotation(angle + Math.PI / 2).setScale(1, 0.6);

        this.scene.tweens.add({
            targets: slash, alpha: 0, duration: 250, ease: 'Cubic.easeOut',
            onComplete: () => slash.destroy()
        });
    
        this.scene.time.delayedCall(150, () => playerContainer.active && playerContainer.setData('isAttacking', false));
    }
    
    performRangedAttack() {
        const localPlayer = this.getLocalPlayer();
        const target = this.scene.inputManager.currentTarget;

        if (this.scene.playerData.class === 'Ranger') {
            if (Phaser.Math.Distance.Between(localPlayer.x, localPlayer.y, target.x, target.y) > 950) {
                this.scene.uiManager.displayStatusMessage('Target is too far away!', 1000);
                return;
            }
        }

        this.scene.projectileManager.firePlayerProjectile(localPlayer, target);
    }
}