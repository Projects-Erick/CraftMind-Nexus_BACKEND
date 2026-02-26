const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

// GET /reports — dashboard geral para ReportsPage
router.get('/', authenticate, authorize('admin', 'secretary', 'teacher'), async (req, res) => {
  try {
    const { classId } = req.query;
    const classFilter = classId ? 'AND cs.class_id = ?' : '';
    const classParam  = classId ? [classId] : [];

    const [school, byClass, bySubject, xpTop, bimesterTrend] = await Promise.all([
      db.queryOne(`
        SELECT
          (SELECT COUNT(*) FROM users u JOIN roles r ON u.role_id = r.id WHERE r.name = 'student' AND u.is_active = TRUE) as totalStudents,
          (SELECT COUNT(*) FROM assignments WHERE status = 'published') as totalAssignments,
          (SELECT COUNT(*) FROM submissions WHERE status IN ('submitted','graded')) as totalSubmissions,
          (SELECT AVG(g.grade) FROM grades g ${classId ? 'WHERE g.class_id = ?' : 'WHERE 1=1'}) as avgScore
      `, classId ? [classId] : []),

      db.query(`
        SELECT c.id, c.name as class_name, AVG(g.grade) as avg_grade, COUNT(DISTINCT g.student_id) as student_count
        FROM classes c
        LEFT JOIN grades g ON g.class_id = c.id AND g.academic_year = EXTRACT(YEAR FROM NOW())
        ${classId ? 'WHERE c.id = ?' : ''}
        GROUP BY c.id, c.name ORDER BY avg_grade DESC
      `, classId ? [classId] : []),

      db.query(`
        SELECT s.name as subject_name, s.color, AVG(g.grade) as avg_grade
        FROM grades g
        JOIN subjects s ON g.subject_id = s.id
        ${classId ? 'JOIN class_students cs ON g.student_id = cs.student_id AND cs.class_id = ?' : 'WHERE 1=1'}
        AND g.academic_year = EXTRACT(YEAR FROM NOW())
        GROUP BY s.id, s.name, s.color
        ORDER BY avg_grade DESC
      `, classId ? [classId] : []),

      db.query(`
        SELECT u.display_name, u.minecraft_username, xp.total_xp, xp.level
        FROM student_xp xp
        JOIN users u ON xp.student_id = u.id
        ${classId ? 'JOIN class_students cs ON cs.student_id = u.id AND cs.class_id = ?' : ''}
        ORDER BY xp.total_xp DESC LIMIT 15
      `, classId ? [classId] : []),

      db.query(`
        SELECT g.bimester, AVG(g.grade) as avg_grade
        FROM grades g
        ${classId ? 'WHERE g.class_id = ?' : 'WHERE 1=1'}
        AND g.academic_year = EXTRACT(YEAR FROM NOW())
        GROUP BY g.bimester ORDER BY g.bimester
      `, classId ? [classId] : []),
    ]);

    res.json({ school, byClass, bySubject, xpTop, bimesterTrend });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erro ao gerar relatório' });
  }
});

// Relatório geral por turma
router.get('/class/:classId', authenticate, authorize('admin', 'secretary', 'teacher'), async (req, res) => {
  try {
    const { classId } = req.params;
    const { bimester } = req.query;

    const students = await db.query(
      `SELECT u.id, u.display_name, u.minecraft_username, xp.total_xp, xp.level
       FROM class_students cs
       JOIN users u ON cs.student_id = u.id
       LEFT JOIN student_xp xp ON xp.student_id = u.id
       WHERE cs.class_id = ? ORDER BY u.display_name`,
      [classId]
    );

    for (const s of students) {
      let gradeQuery = `
        SELECT s.name as subject_name, g.grade, g.bimester
        FROM grades g JOIN subjects s ON g.subject_id = s.id
        WHERE g.student_id = ? AND g.class_id = ? AND g.academic_year = EXTRACT(YEAR FROM NOW())
      `;
      const gradeParams = [s.id, classId];
      if (bimester) { gradeQuery += ' AND g.bimester = ?'; gradeParams.push(bimester); }

      s.grades = await db.query(gradeQuery, gradeParams);
      s.average = s.grades.length > 0
        ? (s.grades.reduce((sum, g) => sum + parseFloat(g.grade || 0), 0) / s.grades.length).toFixed(2)
        : null;

      s.submissionsCount = (await db.queryOne(
        `SELECT COUNT(*) as c FROM submissions s
         JOIN assignments a ON s.assignment_id = a.id
         WHERE s.student_id = ? AND a.class_id = ?`, [s.id, classId]
      )).c;
    }

    const classInfo = await db.queryOne(
      'SELECT c.name, sy.name as year_name FROM classes c JOIN school_years sy ON c.school_year_id = sy.id WHERE c.id = ?',
      [classId]
    );

    res.json({ class: classInfo, students, generatedAt: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ error: 'Erro ao gerar relatório' });
  }
});

// Relatório individual do aluno
router.get('/student/:studentId', authenticate, async (req, res) => {
  try {
    const { studentId } = req.params;
    if (req.user.role === 'student' && req.user.id !== parseInt(studentId)) {
      return res.status(403).json({ error: 'Sem permissão' });
    }

    const [user, xp, grades, submissions, achievements] = await Promise.all([
      db.queryOne('SELECT u.*, r.name as role FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = ?', [studentId]),
      db.queryOne('SELECT * FROM student_xp WHERE student_id = ?', [studentId]),
      db.query(`
        SELECT g.grade, g.bimester, g.academic_year, s.name as subject_name, c.name as class_name
        FROM grades g JOIN subjects s ON g.subject_id = s.id JOIN classes c ON g.class_id = c.id
        WHERE g.student_id = ? ORDER BY g.academic_year DESC, g.bimester
      `, [studentId]),
      db.query(`
        SELECT sub.score, sub.submitted_at, a.title, a.type, s.name as subject_name
        FROM submissions sub
        JOIN assignments a ON sub.assignment_id = a.id
        JOIN subjects s ON a.subject_id = s.id
        WHERE sub.student_id = ? ORDER BY sub.submitted_at DESC LIMIT 20
      `, [studentId]),
      db.query(`
        SELECT a.name, a.description, a.xp_reward, sa.earned_at
        FROM student_achievements sa JOIN achievements a ON sa.achievement_id = a.id
        WHERE sa.student_id = ?
      `, [studentId])
    ]);

    res.json({ user, xp, grades, submissions, achievements });
  } catch (e) {
    res.status(500).json({ error: 'Erro ao gerar relatório' });
  }
});

module.exports = router;
