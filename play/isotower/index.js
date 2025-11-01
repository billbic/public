
import LobbyScene from './scenes/LobbyScene.js';
import ClassSelectionScene from './scenes/ClassSelectionScene.js';
import GameScene from './scenes/GameScene.js';
import TowerScene from './scenes/TowerScene.js';
import { LOBBY_WIDTH, LOBBY_HEIGHT } from './utils.js';

const config = {
    type: Phaser.AUTO,
    transparent: true,
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

// This addresses a potential race condition where Phaser initializes before the CSS layout
// is fully calculated. Forcing a refresh after the page is fully loaded ensures the
// canvas scales correctly every time.
window.addEventListener('load', () => {
    setTimeout(() => {
        if (game && game.scale) {
            game.scale.refresh();
        }
    }, 100); // A small delay ensures the browser has finished its layout paint.
});
