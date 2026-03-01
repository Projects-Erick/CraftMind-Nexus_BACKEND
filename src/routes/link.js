// backend/src/routes/link.js
// Sistema de vínculo Minecraft ↔ Dashboard por código
const express  = require('express');
const router   = express.Router();
const db       = require('../config/database');
const { authenticate, minecraftAuth } = require('../middleware/auth');

// ── Gera código (chamado pelo dashboard) ──────────────────────
// POST /api/link/generate
router.post('/generate', authenticate, async (req, res) => {
  try {
    // Invalida códigos anteriores do usuário
    await db.query(
      `UPDATE minecraft_link_codes SET used = TRUE WHERE user_id = ? AND used = FALSE`,
      [req.user.id]
    );

    // Gera código de 6 letras maiúsculas + 2 números (ex: CM-AB12)
    const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const digits  = '0123456789';
    const rand = (chars) => chars[Math.floor(Math.random() * chars.length)];
    const code = `${rand(letters)}${rand(letters)}${rand(digits)}${rand(digits)}${rand(letters)}${rand(letters)}`;

    await db.insert(
      `INSERT INTO minecraft_link_codes (user_id, code, expires_at)
       VALUES (?, ?, NOW() + INTERVAL '15 minutes')`,
      [req.user.id, code]
    );

    // Busca o registro criado com expires_at
    const record = await db.queryOne(
      `SELECT code, expires_at FROM minecraft_link_codes
       WHERE user_id = ? AND used = FALSE ORDER BY created_at DESC LIMIT 1`,
      [req.user.id]
    );

    res.json({
      code: record.code,
      expiresAt: record.expires_at,
      expiresInMinutes: 15,
      instruction: `No Minecraft, digite: /vincular ${record.code}`
    });
  } catch (error) {
    console.error('Link generate error:', error);
    res.status(500).json({ error: 'Erro ao gerar código' });
  }
});

// ── Verifica status do vínculo atual ──────────────────────────
// GET /api/link/status
router.get('/status', authenticate, async (req, res) => {
  try {
    const user = await db.queryOne(
      `SELECT minecraft_uuid, minecraft_username FROM users WHERE id = ?`,
      [req.user.id]
    );
    res.json({
      linked: !!(user.minecraft_uuid || user.minecraft_username),
      minecraftUuid:     user.minecraft_uuid     || null,
      minecraftUsername: user.minecraft_username  || null
    });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao verificar vínculo' });
  }
});

// ── Remove vínculo ────────────────────────────────────────────
// DELETE /api/link
router.delete('/', authenticate, async (req, res) => {
  try {
    await db.query(
      `UPDATE users SET minecraft_uuid = NULL, minecraft_username = NULL WHERE id = ?`,
      [req.user.id]
    );
    res.json({ success: true, message: 'Vínculo removido com sucesso' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao remover vínculo' });
  }
});

// ── Plugin usa este endpoint para confirmar o código ──────────
// POST /api/link/confirm  (chamado pelo plugin com x-mc-api-key)
router.post('/confirm', minecraftAuth, async (req, res) => {
  try {
    const { code, minecraftUuid, minecraftUsername } = req.body;

    if (!code || !minecraftUuid || !minecraftUsername) {
      return res.status(400).json({ error: 'Campos obrigatórios: code, minecraftUuid, minecraftUsername' });
    }

    // Busca código válido e não expirado
    const linkCode = await db.queryOne(
      `SELECT lc.id, lc.user_id, u.username, u.display_name
       FROM minecraft_link_codes lc
       JOIN users u ON lc.user_id = u.id
       WHERE lc.code = ?
         AND lc.used = FALSE
         AND lc.expires_at > NOW()`,
      [code.toUpperCase()]
    );

    if (!linkCode) {
      return res.status(404).json({
        success: false,
        message: 'Código inválido ou expirado. Gere um novo no dashboard.'
      });
    }

    // Verifica se o UUID já está vinculado a outra conta
    const existingUser = await db.queryOne(
      `SELECT id, username FROM users WHERE minecraft_uuid = ? AND id != ?`,
      [minecraftUuid, linkCode.user_id]
    );
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: `Este UUID já está vinculado à conta: ${existingUser.username}`
      });
    }

    // Vincula!
    await db.query(
      `UPDATE users SET minecraft_uuid = ?, minecraft_username = ? WHERE id = ?`,
      [minecraftUuid, minecraftUsername, linkCode.user_id]
    );

    // Marca código como usado
    await db.query(
      `UPDATE minecraft_link_codes SET used = TRUE WHERE id = ?`,
      [linkCode.id]
    );

    // Log
    await db.query(
      `INSERT INTO activity_logs (user_id, action, details)
       VALUES (?, 'MINECRAFT_LINKED', ?)`,
      [linkCode.user_id, JSON.stringify({ minecraftUuid, minecraftUsername })]
    ).catch(() => {});

    res.json({
      success: true,
      message: `Conta vinculada com sucesso!`,
      displayName: linkCode.display_name,
      username: linkCode.username
    });

  } catch (error) {
    console.error('Link confirm error:', error);
    res.status(500).json({ error: 'Erro ao confirmar vínculo' });
  }
});

// ── Admin: vincula manualmente qualquer usuário ───────────────
// POST /api/link/admin  (admin only)
router.post('/admin', authenticate, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Apenas administradores podem vincular manualmente' });
  }

  try {
    const { userId, minecraftUsername, minecraftUuid } = req.body;

    if (!userId || !minecraftUsername) {
      return res.status(400).json({ error: 'userId e minecraftUsername são obrigatórios' });
    }

    await db.query(
      `UPDATE users SET minecraft_username = ?, minecraft_uuid = ? WHERE id = ?`,
      [minecraftUsername, minecraftUuid || null, userId]
    );

    const user = await db.queryOne(
      `SELECT username, display_name, minecraft_username FROM users WHERE id = ?`,
      [userId]
    );

    res.json({ success: true, user });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao vincular manualmente' });
  }
});

module.exports = router;
