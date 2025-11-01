

export default class ProjectileManager {
    constructor(scene) {
        this.scene = scene;
        this.playerProjectiles = null;
        this.enemyProjectiles = null;
    }

    createProjectileGroups() {
        this.playerProjectiles = this.scene.physics.add.group({ defaultKey: 'projectile', maxSize: 100 });
        this.enemyProjectiles = this.scene.physics.add.group({ defaultKey: 'enemy_projectile', maxSize: 50 });
    }

    setupHubCollisions(targetDummy, onHit) {
        this.scene.physics.add.overlap(targetDummy, this.playerProjectiles, onHit);
    }
    
    setupTowerCollisions(towerEntitiesGroup, playerSprites, onEnemyHit, onPlayerHit) {
        // Player projectiles hitting enemies
        this.scene.physics.add.overlap(towerEntitiesGroup, this.playerProjectiles, onEnemyHit);

        // Enemy projectiles hitting players
        Object.values(playerSprites).forEach(player => {
            // Only setup overlap for the local player to avoid redundant checks
            if (player.name === this.scene.playerData.name) {
                this.scene.physics.add.overlap(player, this.enemyProjectiles, onPlayerHit);
            }
        });
    }

    firePlayerProjectile(player, target) {
        const texture = this.scene.playerData.class === 'Ranger' ? 'arrow' : 'projectile';
        const projectile = this.playerProjectiles.get(player.x, player.y, texture);
        
        if (projectile) {
            // Aim at the center of the target's physics body, not its visual center.
            // This ensures shots are aimed at the hitbox, which is crucial for the isometric perspective.
            const targetX = target.body.center.x;
            const targetY = target.body.center.y;
            const angle = Phaser.Math.Angle.Between(player.x, player.y, targetX, targetY);

            projectile.setScale(0.7);
            projectile.setRotation(angle);
            projectile.setData({
                owner: this.scene.playerData.name,
                hasHit: false,
            });
            // Use a slightly larger hitbox for the arrow to be more forgiving.
            projectile.body.setCircle(texture === 'arrow' ? 5 : 4);
            projectile.setActive(true).setVisible(true);
            this.scene.physics.moveTo(projectile, targetX, targetY, 600);
            
            if (!this.scene.isOffline) {
                this.scene.socketManager.sendMessage('shoot', {
                    x: projectile.x, y: projectile.y,
                    velocityX: projectile.body.velocity.x,
                    velocityY: projectile.body.velocity.y,
                    rotation: projectile.rotation
                });
            }
        }
    }
    
    spawnRemoteProjectile(data) {
        const texture = data.playerClass === 'Ranger' ? 'arrow' : 'projectile';
        const projectile = this.playerProjectiles.get(data.x, data.y, texture);
        if (projectile) {
            projectile.setScale(0.7);
            projectile.setRotation(data.rotation);
            projectile.setData('owner', data.id).setData('hasHit', false);
            // Match the hitbox size from firePlayerProjectile for consistency.
            projectile.body.setCircle(texture === 'arrow' ? 5 : 4);
            projectile.setActive(true).setVisible(true);
            projectile.body.setVelocity(data.velocityX, data.velocityY);
        }
    }
    
    fireEnemyProjectile(data) {
        const projectile = this.enemyProjectiles.get(data.x, data.y, 'enemy_projectile');
        if (projectile) {
            // Use uniform scaling to ensure the circular hitbox remains a circle for accurate collision.
            projectile.setScale(0.8);
            projectile.setActive(true).setVisible(true);
            projectile.body.setVelocity(data.vx, data.vy);
        }
    }

    kill(projectile) {
        if (!projectile) return;
        projectile.setActive(false).setVisible(false).body.stop();
        if (this.playerProjectiles.contains(projectile)) {
            this.playerProjectiles.killAndHide(projectile);
        } else if (this.enemyProjectiles.contains(projectile)) {
            this.enemyProjectiles.killAndHide(projectile);
        }
    }
    
    killAll() {
        this.playerProjectiles.children.each(p => p.active && this.kill(p));
    }
}