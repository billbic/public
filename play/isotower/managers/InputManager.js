export default class InputManager {
    constructor(scene) {
        this.scene = scene;
        this.keys = null;
        this.currentTarget = null;
        this.clericTarget = null;
        this.justTargeted = false;
        this.justSetClericTarget = false;
    }

    // --- Setup Methods ---

    setupHubInputs() {
        this.setupCommonInputs();
        this.scene.input.on('pointerdown', this.handleHubPointerDown, this);
    }
    
    setupTowerInputs() {
        this.setupCommonInputs();
        this.scene.input.on('pointerdown', this.handleTowerPointerDown, this);
    }

    setupCommonInputs() {
        this.keys = this.scene.input.keyboard.addKeys('W,A,S,D');
        this.scene.input.mouse.disableContextMenu();
        
        this.scene.input.keyboard.on('keydown', (event) => {
            // Do not process any keyboard input if the scene is not active (e.g., transitioning)
            if (!this.scene.scene.isActive()) {
                return;
            }

            // The 'Escape' key should always toggle the pause menu.
            if (event.key === 'Escape') {
                event.preventDefault();
                this.scene.uiManager.togglePauseMenu();
                // Return to ensure no other actions are processed for this key press.
                return;
            }

            // The '`' key should always toggle the admin console.
            if (event.code === 'Backquote') {
                event.preventDefault();
                this.scene.uiManager.toggleAdminConsole();
                return;
            }

            // If the game is paused or the console is open, block all other game-related inputs.
            if (this.scene.scene.isPaused() || this.scene.uiManager.isConsoleOpen) {
                return;
            }

            // --- Game-related inputs below this line ---
            if (event.key === 'Tab') {
                event.preventDefault();
                this.cycleTargets();
            }
        });
    }

    // --- Pointer Handlers ---

    handleHubPointerDown(pointer) {
        if (this.handlePreClickFlags()) return;
        
        if (pointer.rightButtonDown()) {
            this.clearTarget();
            this.setClericTarget(null);
            return;
        }

        if (pointer.leftButtonDown()) {
            if (this.scene.playerData.class === 'Cleric' && this.clericTarget) {
                if (this.clericTarget.getData('playerClass')) {
                    this.scene.socketManager.sendMessage('heal_player', { targetId: this.clericTarget.name });
                } else {
                    this.scene.socketManager.sendMessage('heal_dummy');
                }
            } else if (this.scene.playerData.class !== 'Cleric' && this.currentTarget) {
                this.scene.playerManager.performAttack();
            } else if (!pointer.gameObject) {
                if (this.scene.playerData.class !== 'Cleric') this.clearTarget();
                else this.setClericTarget(null);
            }
        }
    }
    
    handleTowerPointerDown(pointer) {
        if (this.handlePreClickFlags()) return;

        if (pointer.rightButtonDown()) {
            this.clearTarget();
            this.setClericTarget(null);
            return;
        }

        if (pointer.leftButtonDown()) {
            if (this.scene.playerData.class === 'Cleric' && this.clericTarget) {
                if (this.scene.isOffline) return;
                this.scene.socketManager.sendMessage('heal_player', { targetId: this.clericTarget.name });
            } else if (this.scene.playerData.class !== 'Cleric' && this.currentTarget) {
                this.scene.playerManager.performAttack();
            } else if (!pointer.gameObject) {
                if (this.scene.playerData.class !== 'Cleric') this.clearTarget();
            }
        }
    }

    handlePreClickFlags() {
        if (this.justTargeted) {
            this.justTargeted = false;
            return true;
        }
        if (this.justSetClericTarget) {
            this.justSetClericTarget = false;
            return true;
        }
        return false;
    }

    // --- Targeting Logic ---

    handleTargetClick(target) {
        if (this.scene.playerData.class === 'Cleric') {
            if (target.getData('playerClass') && target.name === this.scene.playerData.name) {
                if(this.scene.constructor.name === 'GameScene') {
                    this.scene.uiManager.displayStatusMessage("You can't heal yourself in the Hub.", 1500);
                }
                return;
            }
            this.setClericTarget(target);
            this.justSetClericTarget = true;
            return;
        }

        if (target.getData('isDead')) return;
        this.setTarget(target);
        this.justTargeted = true;
    }
    
    setTarget(target) {
        if (this.scene.playerData.class === 'Cleric') return;
        this.currentTarget = target;

        if (this.scene.constructor.name === 'GameScene' && !this.scene.isOffline) {
            this.scene.socketManager.sendMessage('set_target', { targetId: 'dummy' });
        }
    }

    clearTarget() {
        if (!this.currentTarget) return;
        
        const hadTarget = !!this.currentTarget;
        this.currentTarget = null;

        if (hadTarget && this.scene.constructor.name === 'GameScene' && !this.scene.isOffline) {
            this.scene.socketManager.sendMessage('set_target', { targetId: null });
        }
    }
    
    setClericTarget(target) {
        if (this.clericTarget && this.clericTarget.active) {
            this.scene.playerManager.deselectClericTarget(this.clericTarget);
        }
        this.clericTarget = target;
        if (this.clericTarget) {
            this.scene.playerManager.selectClericTarget(this.clericTarget);
        }
    }
    
    cycleTargets() {
        if (this.scene.playerData.class === 'Cleric') return;

        const localPlayer = this.scene.playerManager.getLocalPlayer();
        if (!localPlayer) return;
        
        let potentialTargets = [];
        if(this.scene.constructor.name === 'GameScene'){
            const dummy = this.scene.enemyManager.targetDummy;
             if (dummy && dummy.active && !dummy.getData('isDead')) {
                potentialTargets.push(dummy);
            }
        } else { // TowerScene
            potentialTargets = Object.values(this.scene.enemyManager.towerEntities)
                .filter(e => e.active && !e.getData('isDead'));
        }

        if (potentialTargets.length === 0) {
            this.clearTarget();
            return;
        }

        potentialTargets.sort((a, b) => {
            const distA = Phaser.Math.Distance.Between(localPlayer.x, localPlayer.y, a.x, a.y);
            const distB = Phaser.Math.Distance.Between(localPlayer.x, localPlayer.y, b.x, b.y);
            return distA - distB;
        });

        const currentIndex = this.currentTarget ? potentialTargets.indexOf(this.currentTarget) : -1;
        const nextIndex = (currentIndex + 1) % potentialTargets.length;
        
        this.setTarget(potentialTargets[nextIndex]);
    }
}