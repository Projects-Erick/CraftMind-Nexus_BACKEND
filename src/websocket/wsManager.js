const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const logger = require('../config/logger');

class WSManager {
  constructor() {
    this.wss = null;
    this.clients = new Map(); // userId -> Set<WebSocket>
  }

  init(server) {
    this.wss = new WebSocket.Server({ server, path: '/ws' });

    this.wss.on('connection', (ws, req) => {
      const params = new URLSearchParams(req.url.split('?')[1]);
      const token = params.get('token');

      if (!token) { ws.close(4001, 'Token não fornecido'); return; }

      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const userId = decoded.userId;

        ws.userId = userId;
        if (!this.clients.has(userId)) this.clients.set(userId, new Set());
        this.clients.get(userId).add(ws);

        logger.info(`WebSocket conectado - userId: ${userId}`);

        ws.send(JSON.stringify({ type: 'CONNECTED', message: 'Conexão estabelecida' }));

        ws.on('message', (data) => {
          try {
            const msg = JSON.parse(data);
            this.handleMessage(ws, userId, msg);
          } catch (e) {
            ws.send(JSON.stringify({ type: 'ERROR', message: 'Mensagem inválida' }));
          }
        });

        ws.on('close', () => {
          const userClients = this.clients.get(userId);
          if (userClients) {
            userClients.delete(ws);
            if (userClients.size === 0) this.clients.delete(userId);
          }
          logger.info(`WebSocket desconectado - userId: ${userId}`);
        });

        ws.on('error', (err) => {
          logger.error(`WebSocket error - userId: ${userId}:`, err);
        });

      } catch (e) {
        ws.close(4002, 'Token inválido');
      }
    });

    logger.info('WebSocket Manager inicializado');
  }

  handleMessage(ws, userId, msg) {
    switch (msg.type) {
      case 'PING':
        ws.send(JSON.stringify({ type: 'PONG' }));
        break;
      case 'SUBSCRIBE_NOTIFICATIONS':
        ws.subscribed = true;
        break;
      default:
        logger.debug(`Unknown WS message type: ${msg.type}`);
    }
  }

  notifyUser(userId, data) {
    const userClients = this.clients.get(parseInt(userId));
    if (!userClients) return;

    const message = JSON.stringify(data);
    for (const ws of userClients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    }
  }

  broadcast(data) {
    const message = JSON.stringify(data);
    for (const [, clients] of this.clients) {
      for (const ws of clients) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(message);
        }
      }
    }
  }

  getConnectedCount() {
    return this.clients.size;
  }
}

module.exports = new WSManager();
