const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

// GET /api/design - Lista designs para professores avaliarem
router.get('/', authenticate, authorize('teacher', 'admin'), async (req, res) => {
  try {
    const { assignmentId } = req.query;
    let sql = `
      SELECT ds.*, s.student_id, u.display_name as student_name,
             a.title as assignment_title, s.status as submission_status
      FROM design_submissions ds
      JOIN submissions s ON ds.submission_id = s.id
      JOIN users u ON s.student_id = u.id
      JOIN assignments a ON s.assignment_id = a.id
      WHERE (
        a.teacher_id = ?
        OR a.class_id IN (SELECT class_id FROM class_teachers WHERE teacher_id = ?)
      )
    `;
    const params = [req.user.id, req.user.id];
    if (assignmentId) { sql += ' AND s.assignment_id = ?'; params.push(assignmentId); }
    sql += ' ORDER BY ds.created_at DESC';
    res.json(await db.query(sql, params));
  } catch (e) { res.status(500).json({ error: 'Erro ao buscar designs' }); }
});

// PUT /api/design/:id/rate - Professor avalia design
router.put('/:id/rate', authenticate, authorize('teacher', 'admin'), async (req, res) => {
  try {
    const { rating, comment } = req.body;
    await db.query(
      'UPDATE design_submissions SET teacher_rating = ?, teacher_comment = ? WHERE id = ?',
      [rating, comment, req.params.id]
    );

    // Atualiza nota da submissão
    const ds = await db.queryOne('SELECT submission_id FROM design_submissions WHERE id = ?', [req.params.id]);
    if (ds) {
      await db.query(`UPDATE submissions SET status = 'graded', score = ?, graded_at = NOW(), graded_by = ? WHERE id = ?`,
        [rating, req.user.id, ds.submission_id]);
    }

    res.json({ message: 'Design avaliado!' });
  } catch (e) { res.status(500).json({ error: 'Erro ao avaliar design' }); }
});

module.exports = router;
