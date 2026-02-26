const jwt = require('jsonwebtoken');
const db = require('../config/database');

// Verifica token JWT
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Token de autenticação não fornecido' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Busca usuário atualizado do banco
    const user = await db.queryOne(
      `SELECT u.id, u.username, u.display_name, u.email, u.minecraft_uuid,
              u.minecraft_username, u.avatar_url, u.is_active, r.name as role
       FROM users u JOIN roles r ON u.role_id = r.id
       WHERE u.id = ?`,
      [decoded.userId]
    );

    if (!user) return res.status(401).json({ error: 'Usuário não encontrado' });
    if (!user.is_active) return res.status(403).json({ error: 'Conta desativada' });

    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expirado' });
    }
    return res.status(401).json({ error: 'Token inválido' });
  }
};

// Verifica se usuário tem os roles necessários
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Não autenticado' });

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: `Acesso negado. Roles permitidos: ${roles.join(', ')}`
      });
    }
    next();
  };
};

// Verifica API Key do Minecraft
const minecraftAuth = (req, res, next) => {
  const apiKey = req.headers['x-mc-api-key'];
  if (!apiKey || apiKey !== process.env.MC_API_KEY) {
    return res.status(401).json({ error: 'API Key do Minecraft inválida' });
  }
  next();
};

// Log de auditoria
const auditLog = (action) => async (req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = async (data) => {
    if (res.statusCode < 400 && req.user) {
      await db.query(
        `INSERT INTO activity_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)`,
        [req.user.id, action, JSON.stringify({ body: req.body, params: req.params }), req.ip]
      ).catch(() => {}); // Non-blocking
    }
    originalJson(data);
  };
  next();
};

module.exports = { authenticate, authorize, minecraftAuth, auditLog };
