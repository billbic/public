export default class UIManager {
    constructor(scene) {
        this.scene = scene;
        
        // Phaser UI
        this.statusText = null;
        this.statusTimer = null;
        this.selectionIndicator = null;
        this.aggroIndicator = null;
        this.safeZoneVisual = null;
        
        // DOM UI (now references to permanent elements in index.html)
        this.pauseMenu = null;
        this.invitePopup = null;
        this.adminConsole = null;
        this.fullscreenChangeHandler = null;
        this.isConsoleOpen = false;
    }

    // --- Creation Methods (Now Initialization Methods) ---

    createHubUI(isOffline, initialOnlinePlayers) {
        this.createCommonUI();
        this.initializePauseMenu(isOffline, 'Disconnect', () => {
             if (!this.scene.isOffline && this.scene.socketManager) {
                this.scene.socketManager.close();
            } else {
                this.scene.scene.start('LobbyScene');
            }
        });
        this.initializeInvitePopup();
        
        if (!isOffline) {
            this.updatePlayerList(initialOnlinePlayers);
        }
    }

    createTowerUI() {
        this.createCommonUI();
        this.initializePauseMenu(true, 'Leave Tower', () => this.scene.leaveTower());
    }
    
    createCommonUI() {
        this.statusText = this.scene.add.text(0, 0, '', {
            fontSize: '18px', color: '#f97316', fontStyle: 'italic'
        }).setOrigin(0.5).setScrollFactor(0).setDepth(10000);
        
        this.selectionIndicator = this.scene.add.image(0, 0, 'selectionIndicator').setVisible(false).setDepth(20000).setScale(1, 0.6);
        this.aggroIndicator = this.scene.add.image(0, 0, 'aggroArrow').setVisible(false).setDepth(20001).setScale(1, 0.6);

        this.positionHud();
    }

    initializePauseMenu(isPartyButtonHidden, disconnectButtonText, disconnectCallback) {
        this.pauseMenu = document.getElementById('pause-menu-container');
        if (!this.pauseMenu) return;

        const menuHtml = `
            <div class="pause-menu-panel">
                <h2 class="panel-title">Paused</h2>
                <button id="resumeBtn" class="menu-btn">Resume</button>
                ${isPartyButtonHidden ? '' : '<button id="partyBtn" class="menu-btn">Party</button>'}
                <button id="fullscreenBtn" class="menu-btn">Fullscreen</button>
                <button id="disconnectBtn" class="menu-btn menu-btn--danger">${disconnectButtonText}</button>
            </div>
            ${isPartyButtonHidden ? '' : `
            <div id="playerListPanel" class="player-list-panel hidden">
                <h3 class="panel-title">Available Players</h3>
                <div id="playerListBody" class="player-list-body"></div>
            </div>`}
        `;
        this.pauseMenu.innerHTML = menuHtml;

        // --- Event Listeners ---
        this.pauseMenu.querySelector('#resumeBtn')?.addEventListener('click', () => this.togglePauseMenu());
        
        const disconnectBtn = this.pauseMenu.querySelector('#disconnectBtn');
        if (disconnectBtn) {
            disconnectBtn.addEventListener('click', () => {
                // FIX: Resume the scene so transitions can occur, and hide the menu
                // to prevent it from persisting after the scene changes.
                if (this.scene.scene.isPaused()) {
                    this.scene.scene.resume();
                }
                this.pauseMenu.classList.remove('visible');

                // Execute the original disconnect logic.
                disconnectCallback();
            });
        }
        
        const partyBtn = this.pauseMenu.querySelector('#partyBtn');
        const playerListPanel = this.pauseMenu.querySelector('#playerListPanel');
        if (partyBtn && playerListPanel) {
            partyBtn.addEventListener('click', () => {
                playerListPanel.classList.toggle('hidden');
            });
        }
    
        this.setupFullscreenButton();
    }
    
    setupFullscreenButton() {
        const fullscreenBtn = this.pauseMenu.querySelector('#fullscreenBtn');
        if (!fullscreenBtn) return;
    
        // FIX: Completely rewritten fullscreen handler for reliability.
        this.fullscreenChangeHandler = () => {
            // Check if the scene is still running to prevent errors during transitions.
            if (!this.scene || !this.scene.sys || !this.scene.sys.isActive()) {
                return;
            }

            const isFullscreen = !!document.fullscreenElement;
            fullscreenBtn.textContent = isFullscreen ? 'Exit Fullscreen' : 'Fullscreen';
    
            // When exiting fullscreen, we must wait for the browser to repaint,
            // then explicitly tell Phaser to resize its canvas.
            if (!isFullscreen) {
                // `requestAnimationFrame` waits for the next browser paint, which is the
                // perfect time to measure the new size of the game container.
                requestAnimationFrame(() => {
                    if (!this.scene || !this.scene.scale) return;
                    const rootEl = document.getElementById('root');
                    if (rootEl) {
                        const { width, height } = rootEl.getBoundingClientRect();
                        this.scene.scale.resize(width, height);
                    }
                });
            }
        };
        document.addEventListener('fullscreenchange', this.fullscreenChangeHandler);
        this.fullscreenChangeHandler(); // Set initial button text.
    
        fullscreenBtn.addEventListener('click', () => {
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

    initializeInvitePopup() {
        this.invitePopup = document.getElementById('invite-popup-container');
        if (!this.invitePopup) return;
        
        const invitePopupHtml = `
            <p id="inviteText" class="invite-popup-text"></p>
            <div class="invite-popup-actions">
                <button id="acceptBtn" class="invite-popup-btn btn-accept">Accept</button>
                <button id="declineBtn" class="invite-popup-btn btn-decline">Decline</button>
            </div>
        `;
        this.invitePopup.innerHTML = invitePopupHtml;
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
        this.adminConsole = document.getElementById('admin-console-container');
        if (!this.adminConsole) return;

        const consoleHTML = `
            <div id="consoleOutput" class="console-output"></div>
            <input type="text" id="consoleInput" class="console-input" placeholder="Enter command..."/>
        `;
        this.adminConsole.innerHTML = consoleHTML;

        const inputField = this.adminConsole.querySelector('#consoleInput');
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
        this.adminConsole.classList.toggle('visible', this.isConsoleOpen);
        const inputField = this.adminConsole.querySelector('#consoleInput');

        if (this.isConsoleOpen) {
            this.scene.input.keyboard.removeCapture('W,A,S,D');
            inputField.focus();
        } else {
            this.scene.input.keyboard.addCapture('W,A,S,D');
            inputField.blur();
        }
    }
    
    logToConsole(message, type = 'system') {
        if (!this.adminConsole) return;
        const output = this.adminConsole.querySelector('#consoleOutput');
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
        
        // No longer need to position DOM elements here; CSS handles it.
    }

    togglePauseMenu() {
        if (!this.pauseMenu) return;
        const isPaused = this.scene.scene.isPaused();

        if (isPaused) {
            this.scene.scene.resume();
            this.pauseMenu.classList.remove('visible');
        } else {
            this.scene.scene.pause();
            this.pauseMenu.classList.add('visible');
            const playerList = this.pauseMenu.querySelector('#playerListPanel');
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
        const playerListDiv = this.pauseMenu.querySelector('#playerListBody');
        if (!playerListDiv) return;
        playerListDiv.innerHTML = '';

        const isLeader = this.scene.playerData.name === this.scene.playerData.leader;

        players.forEach(player => {
            if (player.username === this.scene.playerData.name) return;

            const entry = document.createElement('div');
            entry.className = 'player-entry';
            entry.innerHTML = `<span class="player-name">${player.username}</span>`;

            if (isLeader && player.status === 'online_solo') {
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
        if (!this.invitePopup) return;
        
        this.invitePopup.classList.add('visible');
    
        this.invitePopup.querySelector('#inviteText').textContent = `${fromPlayer} invites you to their party!`;
    
        const hidePopup = () => {
            this.invitePopup.classList.remove('visible');
            acceptBtn.onclick = null;
            declineBtn.onclick = null;
        };
    
        const acceptBtn = this.invitePopup.querySelector('#acceptBtn');
        const declineBtn = this.invitePopup.querySelector('#declineBtn');
        
        acceptBtn.onclick = () => {
            this.scene.socketManager.sendMessage('accept_invite', { from: fromPlayer });
            hidePopup();
        };
        declineBtn.onclick = () => {
            this.scene.socketManager.sendMessage('decline_invite', { from: fromPlayer });
            hidePopup();
        };
    }
    
    // --- Shutdown ---
    shutdown() {
        if (this.statusTimer) clearTimeout(this.statusTimer);
        if (this.fullscreenChangeHandler) {
            document.removeEventListener('fullscreenchange', this.fullscreenChangeHandler);
        }
        // No need to destroy DOM elements as they are persistent. Just nullify references.
        this.invitePopup = null;
        this.pauseMenu = null;
        this.adminConsole = null;
    }
}