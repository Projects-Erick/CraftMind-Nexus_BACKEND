const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

router.get('/', authenticate, async (req, res) => {
  try {
    let sql = `
      SELECT c.*, sy.name as year_name, sy.level,
             (SELECT COUNT(*) FROM class_students cs WHERE cs.class_id = c.id) as student_count
      FROM classes c JOIN school_years sy ON c.school_year_id = sy.id
      WHERE c.is_active = TRUE
    `;
    const params = [];

    if (req.user.role === 'teacher') {
      sql += ' AND c.id IN (SELECT class_id FROM class_teachers WHERE teacher_id = ?)';
      params.push(req.user.id);
    } else if (req.user.role === 'student') {
      sql += ' AND c.id IN (SELECT class_id FROM class_students WHERE student_id = ?)';
      params.push(req.user.id);
    }
    sql += ' ORDER BY sy.year_number, c.name';
    res.json(await db.query(sql, params));
  } catch (e) { res.status(500).json({ error: 'Erro ao buscar turmas' }); }
});

router.get('/:id', authenticate, async (req, res) => {
  try {
    const cls = await db.queryOne(
      `SELECT c.*, sy.name as year_name FROM classes c
       JOIN school_years sy ON c.school_year_id = sy.id WHERE c.id = ?`,
      [req.params.id]
    );
    if (!cls) return res.status(404).json({ error: 'Turma não encontrada' });

    cls.students = await db.query(
      `SELECT u.id, u.display_name, u.minecraft_username, u.avatar_url, xp.total_xp, xp.level
       FROM class_students cs JOIN users u ON cs.student_id = u.id
       LEFT JOIN student_xp xp ON xp.student_id = u.id
       WHERE cs.class_id = ? ORDER BY u.display_name`,
      [req.params.id]
    );

    cls.teachers = await db.query(
      `SELECT u.id, u.display_name, s.name as subject_name, s.color
       FROM class_teachers ct
       JOIN users u ON ct.teacher_id = u.id
       JOIN subjects s ON ct.subject_id = s.id
       WHERE ct.class_id = ?`,
      [req.params.id]
    );

    res.json(cls);
  } catch (e) { res.status(500).json({ error: 'Erro ao buscar turma' }); }
});

router.post('/', authenticate, authorize('admin', 'secretary'), async (req, res) => {
  try {
    const { name, code, schoolYearId, academicYear, maxStudents } = req.body;
    const result = await db.insert(
      'INSERT INTO classes (name, code, school_year_id, academic_year, max_students) VALUES (?, ?, ?, ?, ?)',
      [name, code, schoolYearId, academicYear || new Date().getFullYear(), maxStudents || 40]
    );
    res.status(201).json({ message: 'Turma criada', classId: result.insertId });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Código de turma já existe' });
    res.status(500).json({ error: 'Erro ao criar turma' });
  }
});

router.post('/:id/students', authenticate, authorize('admin', 'secretary'), async (req, res) => {
  try {
    const { studentIds } = req.body;
    for (const sid of studentIds) {
      await db.query(
        'INSERT INTO class_students (class_id, student_id) VALUES (?, ?) ON CONFLICT DO NOTHING',
        [req.params.id, sid]
      );
    }
    res.json({ message: 'Alunos adicionados' });
  } catch (e) { res.status(500).json({ error: 'Erro ao adicionar alunos' }); }
});

router.delete('/:id/students/:studentId', authenticate, authorize('admin', 'secretary'), async (req, res) => {
  try {
    await db.query('DELETE FROM class_students WHERE class_id = ? AND student_id = ?',
      [req.params.id, req.params.studentId]);
    res.json({ message: 'Aluno removido da turma' });
  } catch (e) { res.status(500).json({ error: 'Erro ao remover aluno' }); }
});

router.post('/:id/teachers', authenticate, authorize('admin', 'secretary'), async (req, res) => {
  try {
    const { teacherId, subjectId } = req.body;
    await db.query(
      'INSERT INTO class_teachers (class_id, teacher_id, subject_id) VALUES (?, ?, ?) ON CONFLICT DO NOTHING',
      [req.params.id, teacherId, subjectId]
    );
    res.json({ message: 'Professor vinculado' });
  } catch (e) { res.status(500).json({ error: 'Erro ao vincular professor' }); }
});

module.exports = router;
