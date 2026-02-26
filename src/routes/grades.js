const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

router.get('/', authenticate, async (req, res) => {
  try {
    const { studentId, classId, subjectId, bimester } = req.query;
    let sql = `
      SELECT g.*, s.name as subject_name, s.color, c.name as class_name,
             u.display_name as student_name
      FROM grades g
      JOIN subjects s ON g.subject_id = s.id
      JOIN classes c ON g.class_id = c.id
      JOIN users u ON g.student_id = u.id
      WHERE g.academic_year = EXTRACT(YEAR FROM NOW())
    `;
    const params = [];

    if (req.user.role === 'student') {
      sql += ' AND g.student_id = ?'; params.push(req.user.id);
    } else if (studentId) {
      sql += ' AND g.student_id = ?'; params.push(studentId);
    }
    if (classId) { sql += ' AND g.class_id = ?'; params.push(classId); }
    if (subjectId) { sql += ' AND g.subject_id = ?'; params.push(subjectId); }
    if (bimester) { sql += ' AND g.bimester = ?'; params.push(bimester); }
    sql += ' ORDER BY s.name, g.bimester';

    res.json(await db.query(sql, params));
  } catch (e) { res.status(500).json({ error: 'Erro ao buscar notas' }); }
});

router.put('/', authenticate, authorize('teacher', 'admin'), async (req, res) => {
  try {
    const { studentId, classId, subjectId, bimester, grade, observations } = req.body;
    const year = new Date().getFullYear();
    await db.query(
      `INSERT INTO grades (student_id, class_id, subject_id, bimester, academic_year, grade, observations)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (student_id, class_id, subject_id, bimester, academic_year)
       DO UPDATE SET grade = EXCLUDED.grade, observations = EXCLUDED.observations`,
      [studentId, classId, subjectId, bimester, year, grade, observations]
    );
    res.json({ message: 'Nota salva com sucesso' });
  } catch (e) { res.status(500).json({ error: 'Erro ao salvar nota' }); }
});

// PUT /grades/:id — atualiza nota específica pelo id
router.put('/:id', authenticate, authorize('teacher', 'admin'), async (req, res) => {
  try {
    const { grade } = req.body;
    if (grade === undefined || isNaN(parseFloat(grade))) {
      return res.status(400).json({ error: 'Nota inválida' });
    }
    await db.query(
      'UPDATE grades SET grade = ?, updated_at = NOW() WHERE id = ?',
      [parseFloat(grade), req.params.id]
    );
    res.json({ message: 'Nota atualizada' });
  } catch (e) { res.status(500).json({ error: 'Erro ao atualizar nota' }); }
});

module.exports = router;
