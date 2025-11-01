

import { MISS_CHANCE, DAMAGE_VALUES } from '../utils.js';

export default class EnemyManager {
    constructor(scene) {
        this.scene = scene;
        this.targetDummy = null;
        this.towerEntities = {}; // { id: sprite }
        this.towerEntitiesGroup = this.scene.physics.add.group();
        this.exitPortal = null;
        this.currentFloor = 0;
    }
    
    // --- Hub Methods ---
    createTargetDummy(initialHealth, initialAggroTarget) {
        const DUMMY_MAX_HEALTH = 10000;
        this.targetDummy = this.scene.physics.add.sprite(this.scene.physics.world.bounds.width / 2, this.scene.physics.world.bounds.height / 2 + 100, 'targetDummy').setOrigin(0.5);
        this.targetDummy.setScale(2, 1.2);
        const dummyBodyWidth = this.targetDummy.displayWidth * 0.7;
        const dummyBodyHeight = this.targetDummy.displayHeight * 0.4;
        this.targetDummy.body.setSize(dummyBodyWidth, dummyBodyHeight).setImmovable(true).setAllowGravity(false);
        this.targetDummy.body.setOffset(this.targetDummy.width * 0.15, this.targetDummy.height * 0.6);
        this.targetDummy.setInteractive({ useHandCursor: true });
        
        const health = initialHealth !== undefined ? initialHealth : DUMMY_MAX_HEALTH;
        this.targetDummy.setData({
            health: health,
            maxHealth: DUMMY_MAX_HEALTH,
            isDead: health <= 0,
            respawnTimer: null,
            aggroTargetId: initialAggroTarget || null,
        });

        const healthText = this.scene.add.text(this.targetDummy.x, this.targetDummy.y - 100, `${health} / ${DUMMY_MAX_HEALTH}`, { fontSize: '16px', color: '#fff', backgroundColor: 'rgba(0,0,0,0.5)', padding: {x:5, y:2} }).setOrigin(0.5);
        this.targetDummy.setData('healthText', healthText);

        if (health <= 0) this.targetDummy.setAlpha(0.3);

        this.targetDummy.on('pointerdown', () => this.scene.inputManager.handleTargetClick(this.targetDummy));
    }
    
    updateDummyVisuals() {
        if (!this.targetDummy || !this.targetDummy.active) return;
    
        this.targetDummy.getData('healthText')?.setPosition(this.targetDummy.x, this.targetDummy.y - 100);
    
        const aggroIndicator = this.scene.uiManager.aggroIndicator;
        const selectionIndicator = this.scene.uiManager.selectionIndicator;
        if (!aggroIndicator || !selectionIndicator) return;
    
        // --- Aggro Arrow Logic ---
        const aggroTargetId = this.targetDummy.getData('aggroTargetId');
        if (aggroTargetId) {
            const aggroTargetSprite = this.scene.playerManager.getPlayer(aggroTargetId);
            if (aggroTargetSprite && aggroTargetSprite.active) {
                aggroIndicator.setVisible(true);
                const arrowPosX = this.targetDummy.x;
                const arrowPosY = this.targetDummy.y - (this.targetDummy.displayHeight / 2) - 60;
                const angle = Phaser.Math.Angle.Between(arrowPosX, arrowPosY, aggroTargetSprite.x, aggroTargetSprite.y);
                aggroIndicator.setPosition(arrowPosX, arrowPosY).setRotation(angle + Math.PI / 2);
            } else {
                aggroIndicator.setVisible(false);
            }
        } else {
            aggroIndicator.setVisible(false);
        }
    
        // --- Selection Indicator Logic ---
        // Show the indicator if this is the target. Hiding is handled by the scene's main update loop.
        if (this.scene.inputManager.currentTarget === this.targetDummy) {
            selectionIndicator.setVisible(true);
            const reticlePosY = this.targetDummy.y + (this.targetDummy.displayHeight / 2) + 5;
            selectionIndicator.setPosition(this.targetDummy.x, reticlePosY);
        }
    }

    handleDummyHealthUpdate(payload) {
        if (!this.targetDummy || !this.targetDummy.active) return;
        
        const { health, isDead } = payload;
        const oldHealth = this.targetDummy.getData('health');
        
        this.targetDummy.setData('health', health);
        this.targetDummy.getData('healthText')?.setText(`${health} / ${this.targetDummy.getData('maxHealth')}`);
        
        if (health > oldHealth) {
            this.scene.tweens.add({ targets: this.targetDummy, tint: 0x22c55e, duration: 250, yoyo: true });
        } else if (health < oldHealth) {
            this.scene.tweens.add({ targets: this.targetDummy, tint: 0xef4444, duration: 150, yoyo: true });
            this.scene.tweens.add({ targets: this.targetDummy, scaleX: 2.1, scaleY: 1.3, duration: 100, yoyo: true, ease: 'Power1' });
        }
    
        this.targetDummy.setData('isDead', isDead);
        this.targetDummy.setAlpha(isDead ? 0.3 : 1);

        if (isDead) {
            this.scene.uiManager.displayStatusMessage('Target Dummy Destroyed! Resetting...');
            this.updateDummyAggro(null);
            this.scene.inputManager.clearTarget();
            this.scene.projectileManager.killAll();
        }
    }
    
    updateDummyAggro(targetId) {
        if (this.targetDummy) {
            this.targetDummy.setData('aggroTargetId', targetId);
        }
    }

    handleLocalDummyHit() {
        if (this.targetDummy.getData('isDead')) return;

        if (!this.targetDummy.getData('aggroTargetId')) {
            this.updateDummyAggro(this.scene.playerData.name);
        }
        
        if (Math.random() < MISS_CHANCE) {
            this.scene.uiManager.showFloatingText(this.targetDummy, 'Miss', '#ffffff');
            return;
        }

        const damageDealt = DAMAGE_VALUES[this.scene.playerData.class] || 5;
        this.scene.uiManager.showFloatingText(this.targetDummy, `-${damageDealt}`, '#ffdd57');
    
        let currentHealth = this.targetDummy.getData('health') - damageDealt;
    
        if (currentHealth <= 0) {
            this.handleDummyHealthUpdate({ health: 0, isDead: true });
            if (this.targetDummy.getData('respawnTimer')) clearTimeout(this.targetDummy.getData('respawnTimer'));
            const timer = setTimeout(() => {
                if (!this.targetDummy || !this.targetDummy.scene) return;
                this.handleDummyHealthUpdate({ health: this.targetDummy.getData('maxHealth'), isDead: false });
            }, 2000);
            this.targetDummy.setData('respawnTimer', timer);
        } else {
            this.handleDummyHealthUpdate({ health: currentHealth, isDead: false });
        }
    }
    
    // --- Tower Methods ---

    loadFloor(towerState) {
        this.currentFloor = towerState.currentFloor;
        this.towerEntitiesGroup.clear(true, true);
        this.towerEntities = {};

        this.scene.uiManager.drawSafeZone();
        this.scene.uiManager.showFloorAnnouncement(`Floor ${towerState.currentFloor}`);

        towerState.enemies.forEach(minion => this.createEntity(minion));
        this.createEntity(towerState.boss);

        if (this.exitPortal) this.exitPortal.destroy();
        this.exitPortal = this.scene.physics.add.sprite(this.scene.physics.world.bounds.width / 2, this.scene.physics.world.bounds.height / 2 - 300, 'portal').setVisible(false);
        this.exitPortal.body.setAllowGravity(false).setEnable(false);
    }
    
    createEntity(entityData) {
        const entity = this.scene.physics.add.sprite(entityData.x, entityData.y, entityData.type).setInteractive({ useHandCursor: true });
        entity.setScale(1, 0.6);

        const bodyWidth = entity.displayWidth * 0.4;
        const bodyHeight = entity.displayHeight * 0.3;
        entity.body.setSize(bodyWidth, bodyHeight).setOffset(entity.width * 0.3, entity.height * 0.7);

        entity.setData(entityData);
        entity.body.setImmovable(true).setAllowGravity(false);
        entity.on('pointerdown', () => this.scene.inputManager.handleTargetClick(entity));
        
        const healthBar = this.scene.add.graphics();
        const aggroArrow = this.scene.add.image(entity.x, entity.y, 'aggroArrow').setVisible(false).setScale(1, 0.6);
        entity.setData({ healthBar, aggroArrow });
        
        this.towerEntities[entityData.id] = entity;
        this.towerEntitiesGroup.add(entity);
        this.scene.physics.add.collider(this.scene.playerManager.playerGroup, entity, null, () => false);
    }

    handleEntityUpdate(data) {
        const entity = this.towerEntities[data.id];
        if (entity) {
            const oldHealth = entity.getData('health');
            if (data.health !== undefined) {
                entity.setData('health', data.health);
                if (data.health < oldHealth) {
                    this.scene.tweens.add({ targets: entity, scaleX: 1.1, scaleY: 0.7, duration: 100, yoyo: true, ease: 'Power1' });
                }
            }
            if (data.isDead !== undefined) {
                entity.setData('isDead', data.isDead);
                if (data.isDead) {
                    this.scene.tweens.add({ targets: entity, alpha: 0, duration: 300, onComplete: () => entity.setVisible(false) });
                    
                    // If the dead entity was the current target, clear it AND hide the global selection indicator.
                    if (this.scene.inputManager.currentTarget === entity) {
                        this.scene.inputManager.clearTarget();
                        this.scene.uiManager.selectionIndicator.setVisible(false);
                    }

                    // Hide the entity's personal aggro arrow.
                    const arrow = entity.getData('aggroArrow');
                    if (arrow) {
                        arrow.setVisible(false);
                    }
                }
            }
            if (data.aggroTargetId !== undefined) {
                entity.setData('aggroTargetId', data.aggroTargetId);
            }
        }
    }
    
    handleLocalEntityHit(entity) {
        if (Math.random() < MISS_CHANCE) {
            this.scene.uiManager.showFloatingText(entity, 'Miss', '#ffffff');
        } else {
            const damage = DAMAGE_VALUES[this.scene.playerData.class] || 5;
            this.scene.uiManager.showFloatingText(entity, `-${damage}`, '#ffdd57');
            let health = entity.getData('health') - damage;
            const isDead = health <= 0;
            this.handleEntityUpdate({ id: entity.getData('id'), health: Math.max(0, health), isDead });
            if (isDead) this.checkFloorCleared();
        }
    }

    onFloorCleared() {
        this.scene.uiManager.displayStatusMessage('Floor Cleared! Portal is now active.');
        this.exitPortal.setVisible(true).body.setEnable(true);
    }

    checkFloorCleared() {
        const allDead = Object.values(this.towerEntities).every(e => e.getData('isDead'));
        if(allDead) this.onFloorCleared();
    }

    getEntity(id) {
        return this.towerEntities[id];
    }
    
    getCurrentFloor() {
        return this.currentFloor;
    }
    
    // --- AI Methods & Updates ---
    update(time, delta, isOffline, players) {
        if (isOffline) {
            this.updateOfflineAI(time, delta, players);
        }
    
        // Manage global selection indicator visibility before iterating.
        // This ensures it's hidden if the target is cleared or becomes invalid.
        if (!this.scene.inputManager.currentTarget || !this.scene.inputManager.currentTarget.active) {
            this.scene.uiManager.selectionIndicator.setVisible(false);
        }
        
        Object.values(this.towerEntities).forEach(entity => {
            if (!entity.active) return;
            this.updateHealthBar(entity);
            this.updateEntityVisuals(entity);
        });
    }

    updateHealthBar(entity) {
        const healthBar = entity.getData('healthBar');
        if (!healthBar) return;
        healthBar.clear();
        if (entity.getData('isDead')) return;

        const health = entity.getData('health');
        const maxHealth = entity.getData('maxHealth');
        const barWidth = entity.displayWidth * 0.8;
        const barHeight = 8;
        const x = entity.x - barWidth / 2;
        const y = entity.y - entity.displayHeight / 2 - 35;

        healthBar.fillStyle(0x000000, 0.5);
        healthBar.fillRect(x, y, barWidth, barHeight);
        healthBar.fillStyle(0xef4444, 1);
        healthBar.fillRect(x, y, barWidth * (health/maxHealth), barHeight);
    }
    
    updateEntityVisuals(entity) {
        const selectionIndicator = this.scene.uiManager.selectionIndicator;
    
        // If an entity is dead, ensure all its indicators are hidden.
        if (entity.getData('isDead')) {
            const arrow = entity.getData('aggroArrow');
            if (arrow) arrow.setVisible(false);
            
            // If this dead entity was the target, explicitly hide the global selection indicator.
            if (this.scene.inputManager.currentTarget === entity) {
                selectionIndicator.setVisible(false);
            }
            return;
        }
    
        // --- Aggro Arrow Logic ---
        const arrow = entity.getData('aggroArrow');
        if (arrow) {
            const aggroTargetId = entity.getData('aggroTargetId');
            if (aggroTargetId) {
                const targetPlayer = this.scene.playerManager.getPlayer(aggroTargetId);
                if (targetPlayer && targetPlayer.active) {
                    arrow.setVisible(true);
                    const arrowPosX = entity.x;
                    const arrowPosY = entity.y - (entity.displayHeight / 2) - 85;
                    const angle = Phaser.Math.Angle.Between(arrowPosX, arrowPosY, targetPlayer.x, targetPlayer.y);
                    arrow.setPosition(arrowPosX, arrowPosY).setRotation(angle + Math.PI / 2);
                } else {
                    arrow.setVisible(false);
                }
            } else {
                arrow.setVisible(false);
            }
        }
        
        // --- Selection Indicator Logic ---
        // Show the indicator ONLY if this entity is the current target.
        // The main update loop handles hiding it if there is no target.
        if (this.scene.inputManager.currentTarget === entity) {
            selectionIndicator.setVisible(true);
            const reticlePosY = entity.y + (entity.displayHeight * 0.3) + 10;
            selectionIndicator.setPosition(entity.x, reticlePosY);
        }
    }

    updateOfflineAI(time, delta, players) {
        const localPlayer = this.scene.playerManager.getLocalPlayer();
        if (!localPlayer) return;
    
        const isPlayerSafe = localPlayer.y >= (this.scene.physics.world.bounds.height - 200);
        const ENEMY_DETECTION_RANGE = 500;
    
        Object.values(this.towerEntities).forEach(entity => {
            if (entity.getData('isDead')) {
                if (entity.body) entity.body.setVelocity(0, 0);
                return;
            }

            let targetPlayer = null;
            const currentTargetId = entity.getData('aggroTargetId');

            // 1. Check if existing target is still valid (not in safe zone)
            if (currentTargetId) {
                const existingTarget = this.scene.playerManager.getPlayer(currentTargetId);
                if (existingTarget) {
                    const isTargetSafe = existingTarget.y >= (this.scene.physics.world.bounds.height - 200);
                    if (!isTargetSafe) {
                        targetPlayer = existingTarget;
                    } else {
                        // Target has returned to safe zone, drop aggro
                        entity.setData('aggroTargetId', null);
                    }
                } else {
                    // Target no longer exists
                    entity.setData('aggroTargetId', null);
                }
            }

            // 2. If no valid target, try to acquire a new one within range
            if (!targetPlayer && !isPlayerSafe) {
                const distanceToPlayer = Phaser.Math.Distance.Between(entity.x, entity.y, localPlayer.x, localPlayer.y);
                if (distanceToPlayer < ENEMY_DETECTION_RANGE) {
                    targetPlayer = localPlayer;
                    entity.setData('aggroTargetId', targetPlayer.name);
                }
            }

            // 3. If there's no target, enemy is idle.
            if (!targetPlayer) {
                if (entity.body) entity.body.setVelocity(0, 0);
                return;
            }

            // 4. If there is a target, execute AI behavior (move/attack)
            const distanceToTarget = Phaser.Math.Distance.Between(entity.x, entity.y, targetPlayer.x, targetPlayer.y);
            const now = time;
    
            if (entity.getData('type') === 'minion') {
                const MELEE_RANGE = 70;
                const MINION_SPEED = 150;
                const ATTACK_COOLDOWN = 2500;
                const DAMAGE = 10;
    
                const telegraphEndTime = entity.getData('telegraphEndTime');
                const attackCooldown = entity.getData('attackCooldown') || 0;
    
                if (telegraphEndTime && now >= telegraphEndTime) {
                    entity.setData('telegraphEndTime', null);
                    entity.setData('attackCooldown', now + ATTACK_COOLDOWN);
                    if (Phaser.Math.Distance.Between(entity.x, entity.y, targetPlayer.x, targetPlayer.y) <= MELEE_RANGE + 20) {
                        this.scene.playerManager.handlePlayerDamaged({ id: targetPlayer.name, newHealth: Math.max(0, targetPlayer.getData('health') - DAMAGE) });
                        this.handleEnemyAttack({ id: entity.getData('id') });
                    }
                } else if (distanceToTarget > MELEE_RANGE && !telegraphEndTime) {
                    this.scene.physics.moveToObject(entity, targetPlayer, MINION_SPEED);
                } else if (distanceToTarget <= MELEE_RANGE && now > attackCooldown && !telegraphEndTime) {
                    entity.body.setVelocity(0, 0);
                    entity.setData('telegraphEndTime', now + 500);
                    const angle = Phaser.Math.Angle.Between(entity.x, entity.y, targetPlayer.x, targetPlayer.y);
                    this.handleEnemyTelegraph({ id: entity.getData('id'), x: entity.x + Math.cos(angle) * 40, y: entity.y + Math.sin(angle) * 40, angle: angle });
                } else if (distanceToTarget <= MELEE_RANGE && !telegraphEndTime) {
                    entity.body.setVelocity(0, 0);
                }
            } else if (entity.getData('type') === 'boss') {
                const ATTACK_COOLDOWN = 3000;
                const PROJECTILE_SPEED = 400;
                const attackCooldown = entity.getData('attackCooldown') || 0;
    
                if (now > attackCooldown) {
                    entity.setData('attackCooldown', now + ATTACK_COOLDOWN);
                    entity.setData('attackCounter', (entity.getData('attackCounter') || 0) + 1);
                    const angle = Phaser.Math.Angle.Between(entity.x, entity.y, targetPlayer.x, targetPlayer.y);
    
                    if (entity.getData('attackCounter') % 3 === 0) {
                        [-0.25, 0, 0.25].forEach(spread => this.scene.projectileManager.fireEnemyProjectile({ x: entity.x, y: entity.y, vx: Math.cos(angle + spread) * PROJECTILE_SPEED, vy: Math.sin(angle + spread) * PROJECTILE_SPEED }));
                    } else {
                        this.scene.projectileManager.fireEnemyProjectile({ x: entity.x, y: entity.y, vx: Math.cos(angle) * PROJECTILE_SPEED, vy: Math.sin(angle) * PROJECTILE_SPEED });
                    }
                }
            }
        });
    }

    handleEnemyMove(data) {
        const entity = this.towerEntities[data.id];
        if (entity) {
            entity.setData('aggroTargetId', data.targetId);
            this.scene.tweens.add({ targets: entity, x: data.x, y: data.y, duration: 200, ease: 'Linear' });
        }
    }
    
    handleEnemyAttack(data) {
        const entity = this.towerEntities[data.id];
        if (entity) {
            this.scene.tweens.add({ targets: entity, scaleX: 1.2, scaleY: 1.2, yoyo: true, duration: 100, ease: 'Cubic.easeInOut' });
        }
    }

    handleEnemyTelegraph(data) {
        const telegraphSprite = this.scene.add.sprite(data.x, data.y, 'telegraph_rect').setRotation(data.angle).setAlpha(0).setScale(2);
        const minion = this.towerEntities[data.id];
        if (minion) telegraphSprite.setDepth(minion.depth - 1);

        this.scene.tweens.add({
            targets: telegraphSprite, alpha: 1, duration: 100, yoyo: true, hold: 300,
            onComplete: () => telegraphSprite.destroy()
        });
    }
    
    // --- Shutdown ---
    shutdown() {
        if (this.targetDummy && this.targetDummy.getData('respawnTimer')) {
            clearTimeout(this.targetDummy.getData('respawnTimer'));
        }
    }
}