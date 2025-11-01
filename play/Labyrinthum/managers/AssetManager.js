
export default class AssetManager {
    static preload(scene) {
        // Backgrounds
        scene.load.image('floor1', 'https://www.breakingpointgames.com/play/isotower/images/iso_floor2.svg');

        // Entities
        scene.load.image('targetDummy', 'https://www.breakingpointgames.com/play/isotower/images/dummy_64px.png');
        scene.load.image('minion', 'https://www.breakingpointgames.com/play/isotower/images/minion_128px.png');
        scene.load.image('boss', 'https://www.breakingpointgames.com/play/isotower/images/lady_256px.png');
        scene.load.image('portal', 'https://www.breakingpointgames.com/play/isotower/images/portal_64px.png');
        
        // Player Classes
        scene.load.image('paladin', 'https://www.breakingpointgames.com/play/isotower/images/class_paladin.png');
        scene.load.image('fighter', 'https://www.breakingpointgames.com/play/isotower/images/class_fighter.png');
        scene.load.image('cleric', 'https://www.breakingpointgames.com/play/isotower/images/class_cleric.png');
        scene.load.image('ranger', 'https://www.breakingpointgames.com/play/isotower/images/class_ranger.png');
        
        // Player Selected States
        scene.load.image('selected_paladin', 'https://www.breakingpointgames.com/play/isotower/images/selected_paladin.png');
        scene.load.image('selected_fighter', 'https://www.breakingpointgames.com/play/isotower/images/selected_fighter.png');
        scene.load.image('selected_cleric', 'https://www.breakingpointgames.com/play/isotower/images/selected_cleric.png');
        scene.load.image('selected_ranger', 'https://www.breakingpointgames.com/play/isotower/images/selected_ranger.png');

        // UI & Effects
        scene.load.image('aggroArrow', 'https://www.breakingpointgames.com/play/isotower/images/aggroarrow_64px.png');
        scene.load.image('selectionIndicator', 'https://www.breakingpointgames.com/play/isotower/images/targetarrow_64px.png');
        
        // Generate dynamic textures if they don't exist
        if (!scene.textures.exists('projectile')) {
            const graphics = scene.make.graphics();
            graphics.fillStyle(0xf97316, 1);
            graphics.fillCircle(4, 4, 4);
            graphics.generateTexture('projectile', 8, 8);
            graphics.clear();
            
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

            graphics.lineStyle(4, 0xffff00, 0.8);
            graphics.beginPath();
            graphics.arc(32, 32, 28, Phaser.Math.DegToRad(220), Phaser.Math.DegToRad(320), false);
            graphics.strokePath();
            graphics.generateTexture('slash', 64, 64);
            graphics.clear();
            
            graphics.fillStyle(0xef4444, 1);
            graphics.fillCircle(6, 6, 6);
            graphics.generateTexture('enemy_projectile', 12, 12);
            graphics.clear();

            graphics.fillStyle(0xff0000, 0.5);
            graphics.fillRect(0, 0, 80, 40);
            graphics.generateTexture('telegraph_rect', 80, 40);

            graphics.destroy();
        }
    }
}
