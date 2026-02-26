// users.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

router.get('/', authenticate, authorize('admin', 'secretary'), async (req, res) => {
  try {
    const { role, search, classId } = req.query;
    let sql = `
      SELECT u.id, u.username, u.display_name, u.email, u.minecraft_username,
             u.is_active, u.last_login, u.created_at, r.name as role
      FROM users u JOIN roles r ON u.role_id = r.id WHERE 1=1
    `;
    const params = [];
    if (role) { sql += ' AND r.name = ?'; params.push(role); }
    if (search) { sql += ' AND (u.username LIKE ? OR u.display_name LIKE ? OR u.email LIKE ?)'; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
    if (classId) { sql += ' AND u.id IN (SELECT student_id FROM class_students WHERE class_id = ?)'; params.push(classId); }
    sql += ' ORDER BY u.created_at DESC LIMIT 500';
    res.json(await db.query(sql, params));
  } catch (e) { res.status(500).json({ error: 'Erro ao buscar usuários' }); }
});

router.get('/:id', authenticate, async (req, res) => {
  try {
    const targetId = parseInt(req.params.id);
    if (req.user.role === 'student' && req.user.id !== targetId) {
      return res.status(403).json({ error: 'Sem permissão' });
    }
    const user = await db.queryOne(
      `SELECT u.id, u.username, u.display_name, u.email, u.bio, u.avatar_url,
              u.minecraft_uuid, u.minecraft_username, u.created_at, r.name as role,
              xp.total_xp, xp.level
       FROM users u JOIN roles r ON u.role_id = r.id
       LEFT JOIN student_xp xp ON xp.student_id = u.id
       WHERE u.id = ?`, [targetId]
    );
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });
    res.json(user);
  } catch (e) { res.status(500).json({ error: 'Erro ao buscar usuário' }); }
});

router.put('/:id/toggle', authenticate, authorize('admin', 'secretary'), async (req, res) => {
  try {
    const user = await db.queryOne('SELECT is_active FROM users WHERE id = ?', [req.params.id]);
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });
    await db.query('UPDATE users SET is_active = ? WHERE id = ?', [!user.is_active, req.params.id]);
    res.json({ isActive: !user.is_active });
  } catch (e) { res.status(500).json({ error: 'Erro ao atualizar usuário' }); }
});

router.put('/:id/reset-password', authenticate, authorize('admin', 'secretary'), async (req, res) => {
  try {
    const { newPassword } = req.body;
    const hash = await bcrypt.hash(newPassword || 'Mudar@123', 12);
    await db.query('UPDATE users SET password_hash = ? WHERE id = ?', [hash, req.params.id]);
    res.json({ message: 'Senha redefinida com sucesso' });
  } catch (e) { res.status(500).json({ error: 'Erro ao redefinir senha' }); }
});


// PUT /:id — Editar dados completos do usuário (admin only)
router.put('/:id', authenticate, authorize('admin', 'secretary'), async (req, res) => {
  try {
    const { displayName, email, username, role, minecraftUsername, minecraftUuid } = req.body;
    const targetId = parseInt(req.params.id);

    // Somente admin pode mudar role, e não pode rebaixar outro admin
    if (role) {
      if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Apenas admin pode alterar o cargo' });
      }
      const target = await db.queryOne('SELECT r.name as role FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = ?', [targetId]);
      if (target?.role === 'admin' && req.user.id !== targetId) {
        return res.status(403).json({ error: 'Não é possível editar outro admin' });
      }
    }

    const roleRow = role ? await db.queryOne('SELECT id FROM roles WHERE name = ?', [role]) : null;

    const fields = [];
    const params = [];
    if (displayName)       { fields.push('display_name = ?');       params.push(displayName); }
    if (email !== undefined){ fields.push('email = ?');              params.push(email || null); }
    if (username)          { fields.push('username = ?');            params.push(username); }
    if (roleRow)           { fields.push('role_id = ?');             params.push(roleRow.id); }
    if (minecraftUsername !== undefined) { fields.push('minecraft_username = ?'); params.push(minecraftUsername || null); }
    if (minecraftUuid !== undefined)     { fields.push('minecraft_uuid = ?');     params.push(minecraftUuid || null); }

    if (fields.length === 0) return res.status(400).json({ error: 'Nenhum campo para atualizar' });

    params.push(targetId);
    await db.query(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, params);

    // Se mudou para student e não tem XP, cria
    if (role === 'student') {
      const xp = await db.queryOne('SELECT id FROM student_xp WHERE student_id = ?', [targetId]);
      if (!xp) await db.query('INSERT INTO student_xp (student_id) VALUES (?)', [targetId]);
    }

    res.json({ message: 'Usuário atualizado com sucesso' });
  } catch (e) {
    if (e.code === '23505' || e.message?.includes('unique')) {
      return res.status(409).json({ error: 'Username ou email já em uso' });
    }
    res.status(500).json({ error: 'Erro ao atualizar usuário' });
  }
});

// PUT /:id/password — Trocar senha com valor customizado (admin only)
router.put('/:id/password', authenticate, authorize('admin', 'secretary'), async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: 'Senha deve ter no mínimo 6 caracteres' });
    }
    const hash = await bcrypt.hash(newPassword, 12);
    await db.query('UPDATE users SET password_hash = ? WHERE id = ?', [hash, req.params.id]);
    res.json({ message: 'Senha alterada com sucesso' });
  } catch (e) { res.status(500).json({ error: 'Erro ao alterar senha' }); }
});

// DELETE /:id — Deletar usuário (admin only)
router.delete('/:id', authenticate, authorize('admin'), async (req, res) => {
  try {
    const targetId = parseInt(req.params.id);
    if (targetId === req.user.id) {
      return res.status(400).json({ error: 'Você não pode deletar sua própria conta' });
    }
    const target = await db.queryOne(
      'SELECT r.name as role FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = ?',
      [targetId]
    );
    if (!target) return res.status(404).json({ error: 'Usuário não encontrado' });
    if (target.role === 'admin') return res.status(403).json({ error: 'Não é possível deletar outro admin' });

    await db.query('DELETE FROM users WHERE id = ?', [targetId]);
    res.json({ message: 'Usuário deletado' });
  } catch (e) { res.status(500).json({ error: 'Erro ao deletar usuário' }); }
});

module.exports = router;
