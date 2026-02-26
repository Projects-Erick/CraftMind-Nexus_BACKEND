const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');
const logger = require('../config/logger');

// POST /api/auth/login
router.post('/login', [
  body('username').trim().notEmpty().withMessage('Username obrigatório'),
  body('password').notEmpty().withMessage('Senha obrigatória')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const { username, password } = req.body;

    const user = await db.queryOne(
      `SELECT u.*, r.name as role FROM users u
       JOIN roles r ON u.role_id = r.id
       WHERE (u.username = ? OR u.email = ?) AND u.is_active = TRUE`,
      [username, username]
    );

    if (!user || !await bcrypt.compare(password, user.password_hash)) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    const token = jwt.sign(
      { userId: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    // Atualiza último login
    await db.query('UPDATE users SET last_login = NOW() WHERE id = ?', [user.id]);

    // Log
    await db.query(
      'INSERT INTO activity_logs (user_id, action, ip_address) VALUES (?, ?, ?)',
      [user.id, 'LOGIN', req.ip]
    );

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        email: user.email,
        role: user.role,
        avatarUrl: user.avatar_url,
        minecraftUuid: user.minecraft_uuid,
        minecraftUsername: user.minecraft_username
      }
    });
  } catch (error) {
    logger.error('Login error:', error);
    res.status(500).json({ error: 'Erro ao realizar login' });
  }
});

// POST /api/auth/register (admin/secretaria only - via API)
router.post('/register', authenticate, async (req, res) => {
  if (!['admin', 'secretary'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Sem permissão para criar usuários' });
  }

  try {
    const { username, email, password, role, displayName, minecraftUsername } = req.body;

    const roleRow = await db.queryOne('SELECT id FROM roles WHERE name = ?', [role]);
    if (!roleRow) return res.status(400).json({ error: 'Role inválida' });

    // Admin não pode criar outro admin (apenas admin pode)
    if (role === 'admin' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Apenas admins podem criar outros admins' });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const result = await db.insert(
      `INSERT INTO users (username, email, password_hash, role_id, display_name, minecraft_username)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [username, email, passwordHash, roleRow.id, displayName || username, minecraftUsername || null]
    );

    // Cria XP para alunos
    if (role === 'student') {
      await db.query('INSERT INTO student_xp (student_id) VALUES (?)', [result.insertId]);
    }

    res.status(201).json({
      message: 'Usuário criado com sucesso',
      userId: result.insertId
    });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Username ou email já em uso' });
    }
    logger.error('Register error:', error);
    res.status(500).json({ error: 'Erro ao criar usuário' });
  }
});

// GET /api/auth/me
router.get('/me', authenticate, async (req, res) => {
  try {
    const user = await db.queryOne(
      `SELECT u.id, u.username, u.display_name, u.email, u.bio, u.avatar_url,
              u.minecraft_uuid, u.minecraft_username, u.last_login, u.created_at,
              r.name as role, xp.total_xp, xp.level
       FROM users u
       JOIN roles r ON u.role_id = r.id
       LEFT JOIN student_xp xp ON xp.student_id = u.id
       WHERE u.id = ?`,
      [req.user.id]
    );

    // Map to camelCase for frontend consistency
    res.json({
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      email: user.email,
      bio: user.bio,
      avatarUrl: user.avatar_url,
      minecraftUuid: user.minecraft_uuid,
      minecraftUsername: user.minecraft_username,
      lastLogin: user.last_login,
      createdAt: user.created_at,
      role: user.role,
      totalXp: user.total_xp || 0,
      level: user.level || 1,
    });
  } catch (error) {
    logger.error('Me error:', error);
    res.status(500).json({ error: 'Erro ao buscar perfil' });
  }
});

// PUT /api/auth/profile
router.put('/profile', authenticate, [
  body('displayName').optional().trim().isLength({ min: 2, max: 100 }),
  body('bio').optional().trim().isLength({ max: 500 })
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const { displayName, bio, minecraftUsername, email } = req.body;
    await db.query(
      'UPDATE users SET display_name = ?, bio = ?, minecraft_username = ?, email = ? WHERE id = ?',
      [displayName || req.user.display_name, bio || null, minecraftUsername || null, email || req.user.email, req.user.id]
    );
    res.json({ message: 'Perfil atualizado com sucesso' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao atualizar perfil' });
  }
});

// PUT /api/auth/password
router.put('/password', authenticate, [
  body('currentPassword').notEmpty(),
  body('newPassword').isLength({ min: 6 }).withMessage('Senha mínima 6 caracteres')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const user = await db.queryOne('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
    const valid = await bcrypt.compare(req.body.currentPassword, user.password_hash);
    if (!valid) return res.status(400).json({ error: 'Senha atual incorreta' });

    const newHash = await bcrypt.hash(req.body.newPassword, 12);
    await db.query('UPDATE users SET password_hash = ? WHERE id = ?', [newHash, req.user.id]);

    res.json({ message: 'Senha alterada com sucesso' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao alterar senha' });
  }
});

module.exports = router;
