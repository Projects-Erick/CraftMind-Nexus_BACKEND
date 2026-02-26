const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');

router.get('/ranking', authenticate, async (req, res) => {
  try {
    const { classId, limit = 20 } = req.query;
    let sql = `
      SELECT u.id, u.display_name, u.minecraft_username, u.avatar_url,
             xp.total_xp, xp.level,
             ROW_NUMBER() OVER (ORDER BY xp.total_xp DESC) as rank_position
      FROM student_xp xp JOIN users u ON xp.student_id = u.id
    `;
    const params = [];
    if (classId) {
      sql += ' WHERE xp.student_id IN (SELECT student_id FROM class_students WHERE class_id = ?)';
      params.push(classId);
    }
    sql += ` ORDER BY xp.total_xp DESC LIMIT ?`;
    params.push(parseInt(limit));

    const ranking = await db.query(sql, params);
    res.json(ranking);
  } catch (e) { res.status(500).json({ error: 'Erro ao buscar ranking' }); }
});

router.get('/history/:userId', authenticate, async (req, res) => {
  try {
    const userId = req.user.role === 'student' ? req.user.id : req.params.userId;
    const history = await db.query(
      `SELECT * FROM xp_transactions WHERE student_id = ? ORDER BY created_at DESC LIMIT 50`,
      [userId]
    );
    res.json(history);
  } catch (e) { res.status(500).json({ error: 'Erro ao buscar histórico XP' }); }
});

module.exports = router;
