export default class UIManager {
    constructor(scene) {
        this.scene = scene;
        
        // Phaser UI
        this.statusText = null;
        this.statusTimer = null;
        this.selectionIndicator = null;
        this.aggroIndicator = null;
        this.safeZoneVisual = null;
        
        // DOM UI
        this.pauseMenu = null;
        this.invitePopup = null;
        this.adminConsole = null;
        this.fullscreenChangeHandler = null;
        this.isConsoleOpen = false;
    }

    // --- Creation Methods ---

    createHubUI(isOffline, initialOnlinePlayers) {
        this.createCommonUI();
        this.createPauseMenu(isOffline, 'Disconnect', () => {
             if (!this.scene.isOffline && this.scene.socketManager) {
                this.scene.socketManager.close();
            } else {
                this.scene.scene.start('LobbyScene');
            }
        });
        this.createInvitePopup();
        
        if (!isOffline) {
            this.updatePlayerList(initialOnlinePlayers);
        }
    }

    createTowerUI() {
        this.createCommonUI();
        this.createPauseMenu(true, 'Leave Tower', () => this.scene.leaveTower());
    }
    
    createCommonUI() {
        this.statusText = this.scene.add.text(0, 0, '', {
            fontSize: '18px', color: '#f97316', fontStyle: 'italic'
        }).setOrigin(0.5).setScrollFactor(0).setDepth(10000);
        
        this.selectionIndicator = this.scene.add.image(0, 0, 'selectionIndicator').setVisible(false).setDepth(20000).setScale(1, 0.6);
        this.aggroIndicator = this.scene.add.image(0, 0, 'aggroArrow').setVisible(false).setDepth(20001).setScale(1, 0.6);

        this.positionHud();
    }

    createPauseMenu(isPartyButtonHidden, disconnectButtonText, disconnectCallback) {
        const pauseMenuHTML = `
        <div class="menu-overlay">
            <div class="pause-menu-wrapper">
                <div class="menu-content">
                    <div id="pauseMenuContent">
                        <h2 class="menu-title">Paused</h2>
                        <button class="menu-btn" id="resumeBtn">Resume</button>
                        ${isPartyButtonHidden ? '' : '<button class="menu-btn" id="partyBtn">Party</button>'}
                        <button class="menu-btn" id="fullscreenBtn">Fullscreen</button>
                        <button class="menu-btn menu-btn--danger" id="disconnectBtn">${disconnectButtonText}</button>
                    </div>
                </div>
                ${isPartyButtonHidden ? '' : `
                <div id="playerListWrapper" class="hidden">
                     <div class="player-list-container">
                        <h2 class="player-list-header">Available Players</h2>
                        <div id="playerList"></div>
                     </div>
                </div>`}
            </div>
        </div>`;
    
        this.pauseMenu = this.scene.add.dom(this.scene.scale.width / 2, this.scene.scale.height / 2).createFromHTML(pauseMenuHTML).setScrollFactor(0).setVisible(false);
    
        this.pauseMenu.getChildByID('resumeBtn').addEventListener('pointerdown', () => this.togglePauseMenu());
        this.pauseMenu.getChildByID('disconnectBtn').addEventListener('pointerdown', disconnectCallback);

        const partyBtn = this.pauseMenu.getChildByID('partyBtn');
        if (partyBtn) {
            partyBtn.addEventListener('pointerdown', () => {
                this.pauseMenu.getChildByID('playerListWrapper').classList.toggle('hidden');
            });
        }
    
        this.setupFullscreenButton();
    }
    
    setupFullscreenButton() {
        const fullscreenBtn = this.pauseMenu.getChildByID('fullscreenBtn');
        this.fullscreenChangeHandler = () => {
            if (!this.scene.scene.isActive()) return;
            const rootEl = document.getElementById('root');
            if (fullscreenBtn) {
                fullscreenBtn.textContent = document.fullscreenElement === rootEl ? 'Exit Fullscreen' : 'Fullscreen';
            }
        };
        document.addEventListener('fullscreenchange', this.fullscreenChangeHandler);
        this.fullscreenChangeHandler();
    
        fullscreenBtn.addEventListener('pointerdown', () => {
            const rootEl = document.getElementById('root');
            if (rootEl) {
                if (!document.fullscreenElement) {
                    rootEl.requestFullscreen().catch(err => console.error(`Fullscreen error: ${err.message}`));
                } else {
                    document.exitFullscreen();
                }
                this.togglePauseMenu();
            }
        });
    }

    createInvitePopup() {
        const invitePopupHTML = `
            <div class="invite-popup-overlay">
                <div class="invite-popup-content">
                    <p id="inviteText" class.invite-popup-text"></p>
                    <div class="invite-popup-actions">
                        <button id="acceptBtn" class="invite-popup-btn btn-accept">Accept</button>
                        <button id="declineBtn" class="invite-popup-btn btn-decline">Decline</button>
                    </div>
                </div>
            </div>
        `;
        this.invitePopup = this.scene.add.dom(this.scene.scale.width / 2, this.scene.scale.height / 2).createFromHTML(invitePopupHTML).setScrollFactor(0).setOrigin(0.5);
    }
    
    drawSafeZone() {
        if (!this.safeZoneVisual) {
            this.safeZoneVisual = this.scene.add.graphics().setDepth(1);
            this.scene.add.text(this.scene.physics.world.bounds.width / 2, this.scene.physics.world.bounds.height - 20, 'SAFE ZONE', {
                fontSize: '24px', color: '#ffffff', fontFamily: "'Bebas Neue', cursive",
                stroke: '#000000', strokeThickness: 4, alpha: 0.5
            }).setOrigin(0.5, 1);
        }
        this.safeZoneVisual.clear().fillStyle(0x22c55e, 0.25);
        const { width, height } = this.scene.physics.world.bounds;
        this.safeZoneVisual.fillPoints([
            width / 2, height - 200, width / 2 + 200, height - 100,
            width / 2, height, width / 2 - 200, height - 100
        ], true);
    }

    // --- Admin Console Methods ---
    createAdminConsole() {
        const consoleHTML = `
            <div class="admin-console-overlay">
                <div id="consoleOutput" class="console-output"></div>
                <input type="text" id="consoleInput" class="console-input" placeholder="Enter command..."/>
            </div>`;
        
        this.adminConsole = this.scene.add.dom(0, this.scene.scale.height).createFromHTML(consoleHTML).setScrollFactor(0).setOrigin(0, 1).setVisible(false);

        const inputField = this.adminConsole.getChildByID('consoleInput');
        inputField.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                this.handleCommand(inputField.value);
                inputField.value = '';
            }
        });
    }

    toggleAdminConsole() {
        if (!this.adminConsole) return;
        this.isConsoleOpen = !this.isConsoleOpen;
        this.adminConsole.setVisible(this.isConsoleOpen);
        const inputField = this.adminConsole.getChildByID('consoleInput');

        const zoom = this.scene.cameras.main.zoom;

        if (this.isConsoleOpen) {
            if (zoom !== 1) {
                const inverseZoom = 1 / zoom;
                this.adminConsole.node.style.transformOrigin = 'bottom left';
                this.adminConsole.node.style.transform = `scale(${inverseZoom})`;
            }
            inputField.focus();
        } else {
            this.adminConsole.node.style.transform = ''; // Reset on hide
            inputField.blur();
        }
    }
    
    logToConsole(message, type = 'system') {
        const output = this.adminConsole.getChildByID('consoleOutput');
        const logEntry = document.createElement('div');
        logEntry.className = `log-${type}`;
        logEntry.textContent = message;
        output.appendChild(logEntry);
        output.scrollTop = output.scrollHeight;
    }

    handleCommand(commandString) {
        if (!commandString) return;
        this.logToConsole(`> ${commandString}`, 'command');

        const [command, ...args] = commandString.toLowerCase().split(' ');
        const localPlayer = this.scene.playerManager.getLocalPlayer();
        
        switch(command) {
            case 'invincible':
                const state = args[0] === 'on';
                localPlayer.setData('isInvincible', state);
                this.logToConsole(`Invincibility ${state ? 'enabled' : 'disabled'}.`);
                break;
            case 'currentlocation':
                this.logToConsole(`Player at: X=${Math.round(localPlayer.x)}, Y=${Math.round(localPlayer.y)}`);
                break;
            case 'spawnnpc':
                const npcType = args[0];
                if (npcType === 'minion' || npcType === 'boss') {
                    this.scene.add.image(localPlayer.x, localPlayer.y, npcType).setScale(1, 0.6).setDepth(localPlayer.y);
                    this.logToConsole(`Spawned visual-only ${npcType}.`);
                } else {
                    this.logToConsole('Unknown NPC type. Use "minion" or "boss".', 'error');
                }
                break;
            case 'spawnitem':
                 const itemType = args[0];
                 if (itemType === 'portal') {
                    this.scene.add.image(localPlayer.x, localPlayer.y, 'portal').setDepth(localPlayer.y);
                    this.logToConsole('Spawned visual-only portal.');
                 } else {
                    this.logToConsole('Unknown item type. Use "portal".', 'error');
                 }
                break;
            default:
                this.logToConsole(`Unknown command: "${command}"`, 'error');
        }
    }


    // --- UI Logic ---
    
    positionHud() {
        if (!this.scene.scene.isActive() || !this.statusText) return;
        const { width, height } = this.scene.scale;
        this.statusText.setPosition(width / 2, height - 30);
        if (this.invitePopup) this.invitePopup.setPosition(width / 2, height / 2);
        if (this.pauseMenu) this.pauseMenu.setPosition(width / 2, height / 2);
        if (this.adminConsole) this.adminConsole.setPosition(0, height);
    }

    togglePauseMenu() {
        const isPaused = this.scene.scene.isPaused();
        const zoom = this.scene.cameras.main.zoom;

        if (isPaused) {
            this.scene.scene.resume();
            this.pauseMenu.setVisible(false);
            this.pauseMenu.node.style.transform = ''; // Reset on hide
        } else {
            this.scene.scene.pause();
            this.pauseMenu.setVisible(true);
            if (zoom !== 1) {
                const inverseZoom = 1 / zoom;
                this.pauseMenu.node.style.transformOrigin = 'center center';
                this.pauseMenu.node.style.transform = `scale(${inverseZoom})`;
            }
            const playerList = this.pauseMenu.getChildByID('playerListWrapper');
            if (playerList) playerList.classList.add('hidden');
        }
    }

    displayStatusMessage(message, duration = 3000) {
        if (this.statusText) {
            this.statusText.setText(message);
            if (this.statusTimer) clearTimeout(this.statusTimer);
            this.statusTimer = setTimeout(() => this.statusText && this.statusText.setText(''), duration);
        }
    }

    showFloatingText(target, text, color = '#ffffff') {
        if (!target || !target.active || !this.scene.scene.isActive()) return;
        const combatText = this.scene.add.text(target.x, target.y - (target.displayHeight / 2), text, { 
            fontSize: '20px', color: color, fontFamily: "'Roboto Mono', monospace", 
            stroke: '#000000', strokeThickness: 4, align: 'center'
        }).setOrigin(0.5).setDepth(target.depth + 100);
    
        this.scene.tweens.add({
            targets: combatText, y: combatText.y - 60, alpha: 0, duration: 1500, ease: 'Cubic.easeOut',
            onComplete: () => combatText.destroy()
        });
    }
    
    showFloorAnnouncement(text) {
        const announcement = this.scene.add.text(this.scene.cameras.main.width / 2, this.scene.cameras.main.height / 2, text, {
            fontSize: '64px', color: '#f97316', fontFamily: "'Bebas Neue', cursive",
            stroke: '#000', strokeThickness: 4, align: 'center'
        }).setOrigin(0.5).setScrollFactor(0).setDepth(10001).setAlpha(0);
    
        this.scene.tweens.add({
            targets: announcement, alpha: { from: 0, to: 1 }, duration: 1000,
            ease: 'Power2', yoyo: true, hold: 1500,
            onComplete: () => announcement.destroy()
        });
    }

    updatePlayerList(players) {
        if (!this.pauseMenu) return;
        const playerListDiv = this.pauseMenu.getChildByID('playerList');
        if (!playerListDiv) return;
        playerListDiv.innerHTML = '';

        players.forEach(player => {
            if (player.username === this.scene.playerData.name) return;

            const entry = document.createElement('div');
            entry.className = 'player-entry';
            entry.innerHTML = `<span class="player-name">${player.username}</span>`;

            if (player.status === 'online_solo') {
                const inviteBtn = document.createElement('button');
                inviteBtn.textContent = 'Invite';
                inviteBtn.className = 'player-invite-btn';
                inviteBtn.onclick = () => {
                    this.scene.socketManager.sendMessage('invite', { to: player.username });
                    this.displayStatusMessage(`Inviting ${player.username}...`);
                    inviteBtn.disabled = true;
                    inviteBtn.textContent = 'Sent';
                };
                entry.appendChild(inviteBtn);
            } else {
                const statusMap = { 'in_party': '(In Party)', 'in_tower': '(In Tower)' };
                entry.innerHTML += `<span class="player-status ${player.status === 'in_tower' ? 'player-status--tower' : ''}">${statusMap[player.status] || ''}</span>`;
            }
            playerListDiv.appendChild(entry);
        });
    }

    handleInvite(fromPlayer) {
        const popupNode = this.invitePopup.node.querySelector('.invite-popup-overlay');
        if (!popupNode) return;
    
        popupNode.style.display = 'flex';
    
        const zoom = this.scene.cameras.main.zoom;
        if (zoom !== 1) {
            const inverseZoom = 1 / zoom;
            this.invitePopup.node.style.transformOrigin = 'center center';
            this.invitePopup.node.style.transform = `scale(${inverseZoom})`;
        }
    
        popupNode.querySelector('#inviteText').textContent = `${fromPlayer} invites you to their party!`;
    
        const hideAndReset = () => {
            popupNode.style.display = 'none';
            this.invitePopup.node.style.transform = ''; // Reset transform on hide
        };
    
        popupNode.querySelector('#acceptBtn').onclick = () => {
            this.scene.socketManager.sendMessage('accept_invite', { from: fromPlayer });
            hideAndReset();
        };
        popupNode.querySelector('#declineBtn').onclick = () => {
            this.scene.socketManager.sendMessage('decline_invite', { from: fromPlayer });
            hideAndReset();
        };
    }
    
    // --- Shutdown ---
    shutdown() {
        if (this.statusTimer) clearTimeout(this.statusTimer);
        if (this.fullscreenChangeHandler) {
            document.removeEventListener('fullscreenchange', this.fullscreenChangeHandler);
        }
        if (this.invitePopup) this.invitePopup.destroy();
        if (this.pauseMenu) this.pauseMenu.destroy();
        if (this.adminConsole) this.adminConsole.destroy();
    }
}