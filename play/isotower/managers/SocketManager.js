
import { WEBSOCKET_URL } from '../utils.js';

export default class SocketManager {
    constructor() {
        this.socket = null;
        this.messageHandlers = new Map();
        this.eventHandlers = {
            open: [],
            close: [],
            error: []
        };
    }

    connect() {
        if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
            return;
        }
        this.socket = new WebSocket(WEBSOCKET_URL);
        this.setupEventListeners();
    }

    setupEventListeners() {
        this.socket.onopen = (event) => this.emit('open', event);
        this.socket.onclose = (event) => this.emit('close', event);
        this.socket.onerror = (event) => this.emit('error', event);

        this.socket.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                // Emit a general 'message' event for scene-level switches
                this.emit('message', message);
                // Emit specific events for manager-level handling
                if (this.messageHandlers.has(message.type)) {
                    this.messageHandlers.get(message.type).forEach(handler => handler(message));
                }
            } catch (error) {
                console.error('Error parsing message:', event.data, error);
            }
        };
    }
    
    on(eventName, handler) {
        if (this.eventHandlers[eventName]) {
            this.eventHandlers[eventName].push(handler);
        } else {
            // For custom message types
            if (!this.messageHandlers.has(eventName)) {
                this.messageHandlers.set(eventName, []);
            }
            this.messageHandlers.get(eventName).push(handler);
        }
    }

    emit(eventName, data) {
        if (this.eventHandlers[eventName]) {
            this.eventHandlers[eventName].forEach(handler => handler(data));
        }
    }
    
    sendMessage(type, payload = {}) {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify({ type, payload }));
        } else {
            console.warn(`Socket not open. Could not send message: ${type}`);
        }
    }
    
    clearMessageHandlers() {
        this.messageHandlers.clear();
    }
    
    close() {
        if (this.socket) {
            this.socket.onopen = null;
            this.socket.onmessage = null;
            this.socket.onerror = null;
            this.socket.onclose = null;
            if (this.socket.readyState === WebSocket.OPEN) {
                this.socket.close();
            }
            this.socket = null;
        }
        this.eventHandlers = { open: [], close: [], error: [] };
        this.messageHandlers.clear();
    }
}
