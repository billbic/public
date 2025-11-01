
const WebSocket = require('ws');
const url = require('url');

/**
 * Sets up the WebSocket server for the Dominoes game.
 * @param {import('http').Server} server The shared HTTP server instance.
 */
function setupDominoesServer(server) {
    // Create a new WebSocket server, but don't attach it to the HTTP server directly.
    // 'noServer: true' allows us to manually handle the upgrade requests.
    const wss = new WebSocket.Server({ noServer: true });

    // Listen for the 'upgrade' event on the shared HTTP server.
    server.on('upgrade', (request, socket, head) => {
        // Parse the request URL to determine the path.
        const pathname = url.parse(request.url).pathname;

        // CRITICAL: Check if this connection is intended for the Dominoes game.
        // Each game server MUST have its own unique path.
        if (pathname === '/play/dominoes/ws') {
            // If the path matches, let this WebSocket server handle the connection.
            wss.handleUpgrade(request, socket, head, (ws) => {
                wss.emit('connection', ws, request);
            });
        }
        // If the path does not match, do nothing. The request will be handled
        // by another listener (e.g., for the 'isoTower' game) or ignored.
    });

    // Handle incoming connections for the Dominoes game.
    wss.on('connection', (ws, request) => {
        console.log('A client connected to the Dominoes server!');

        // Handle messages from this client.
        ws.on('message', (message) => {
            console.log(`Dominoes server received: ${message}`);
            
            try {
                // Example: Echo the message back to the client.
                // You would replace this with your actual game logic.
                const data = JSON.parse(message);
                ws.send(JSON.stringify({
                    type: 'echo',
                    payload: data
                }));
            } catch (e) {
                console.error('Error processing message on Dominoes server:', e);
                ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format.' }));
            }
        });

        // Handle the client disconnecting.
        ws.on('close', () => {
            console.log('A client disconnected from the Dominoes server.');
        });

        // Handle any errors.
        ws.on('error', (error) => {
            console.error('Dominoes WebSocket error:', error);
        });
    });

    console.log('Dominoes WebSocket server is ready and listening for connections on /play/dominoes/ws.');
}

// Export the setup function so it can be called from the main server.js file.
module.exports = setupDominoesServer;
