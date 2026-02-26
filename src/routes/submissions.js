const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const logger = require('../config/logger');

// POST /api/submissions/start - Inicia uma submissão
router.post('/start', authenticate, authorize('student'), async (req, res) => {
  try {
    const { assignmentId } = req.body;

    const assignment = await db.queryOne(
      `SELECT a.* FROM assignments a
       JOIN class_students cs ON cs.class_id = a.class_id
       WHERE a.id = ? AND cs.student_id = ? AND a.status = 'published'`,
      [assignmentId, req.user.id]
    );

    if (!assignment) return res.status(404).json({ error: 'Atividade não encontrada ou não disponível' });

    // Verifica se já existe submissão
    const existing = await db.queryOne(
      'SELECT * FROM submissions WHERE assignment_id = ? AND student_id = ?',
      [assignmentId, req.user.id]
    );

    if (existing) {
      return res.json({ submission: existing, message: 'Submissão já existente' });
    }

    const result = await db.insert(
      `INSERT INTO submissions (assignment_id, student_id, status) VALUES (?, ?, 'in_progress')`,
      [assignmentId, req.user.id]
    );

    res.status(201).json({
      submissionId: result.insertId,
      message: 'Submissão iniciada'
    });
  } catch (error) {
    logger.error('Start submission error:', error);
    res.status(500).json({ error: 'Erro ao iniciar submissão' });
  }
});

// POST /api/submissions/:id/answer - Responde uma questão
router.post('/:id/answer', authenticate, authorize('student'), async (req, res) => {
  try {
    const { questionId, selectedOption, answerText } = req.body;

    const submission = await db.queryOne(
      `SELECT s.* FROM submissions s
       JOIN assignments a ON s.assignment_id = a.id
       WHERE s.id = ? AND s.student_id = ? AND s.status = 'in_progress'`,
      [req.params.id, req.user.id]
    );

    if (!submission) return res.status(404).json({ error: 'Submissão não encontrada ou já finalizada' });

    const question = await db.queryOne(
      'SELECT * FROM questions WHERE id = ?',
      [questionId]
    );

    if (!question) return res.status(404).json({ error: 'Questão não encontrada' });

    let isCorrect = null;
    let scoreEarned = 0;

    // Auto-correção para múltipla escolha e verdadeiro/falso
    if (question.question_type === 'multiple_choice' || question.question_type === 'true_false') {
      const correctOption = await db.queryOne(
        'SELECT option_letter FROM question_options WHERE question_id = ? AND is_correct = TRUE',
        [questionId]
      );

      isCorrect = correctOption && selectedOption === correctOption.option_letter;

      // Calcula pontos da questão na atividade
      const aqRow = await db.queryOne(
        'SELECT points_override FROM assignment_questions WHERE assignment_id = ? AND question_id = ?',
        [submission.assignment_id, questionId]
      );

      const points = aqRow?.points_override || question.points;
      scoreEarned = isCorrect ? parseFloat(points) : 0;
    }

    // Upsert da resposta
    await db.query(
      `INSERT INTO submission_answers (submission_id, question_id, selected_option, answer_text, is_correct, score_earned)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (submission_id, question_id)
       DO UPDATE SET selected_option = EXCLUDED.selected_option,
                     answer_text = EXCLUDED.answer_text,
                     is_correct = EXCLUDED.is_correct,
                     score_earned = EXCLUDED.score_earned`,
      [req.params.id, questionId, selectedOption, answerText, isCorrect, scoreEarned]
    );

    res.json({
      isCorrect,
      scoreEarned,
      correctOption: isCorrect === false ? (await db.queryOne(
        'SELECT option_letter, content FROM question_options WHERE question_id = ? AND is_correct = TRUE',
        [questionId]
      )) : null,
      explanation: question.explanation
    });
  } catch (error) {
    logger.error('Answer error:', error);
    res.status(500).json({ error: 'Erro ao registrar resposta' });
  }
});

// POST /api/submissions/:id/submit - Finaliza submissão
router.post('/:id/submit', authenticate, authorize('student'), async (req, res) => {
  try {
    const submission = await db.queryOne(
      `SELECT s.*, a.xp_reward, a.max_score FROM submissions s
       JOIN assignments a ON s.assignment_id = a.id
       WHERE s.id = ? AND s.student_id = ? AND s.status = 'in_progress'`,
      [req.params.id, req.user.id]
    );

    if (!submission) return res.status(404).json({ error: 'Submissão não encontrada' });

    // Calcula score total
    const scoreResult = await db.queryOne(
      'SELECT COALESCE(SUM(score_earned), 0) as total_score FROM submission_answers WHERE submission_id = ?',
      [req.params.id]
    );

    const totalScore = parseFloat(scoreResult.total_score);
    const percentual = (totalScore / submission.max_score) * 100;

    // XP baseado no desempenho
    const xpEarned = Math.round(submission.xp_reward * (percentual / 100));

    await db.transaction(async (conn) => {
      // Atualiza submissão
      await conn.query(
        `UPDATE submissions SET status = 'submitted', score = ?, xp_earned = ?, submitted_at = NOW() WHERE id = ?`,
        [totalScore, xpEarned, req.params.id]
      );

      // Adiciona XP
      await conn.query(
        `INSERT INTO xp_transactions (student_id, xp_amount, source_type, source_id, description)
         VALUES (?, ?, 'submission', ?, ?)`,
        [req.user.id, xpEarned, submission.assignment_id, `Atividade entregue - ${Math.round(percentual)}%`]
      );

      await conn.query(
        `UPDATE student_xp SET total_xp = total_xp + ?,
         level = GREATEST(1, FLOOR(total_xp / 1000) + 1)
         WHERE student_id = ?`,
        [xpEarned, req.user.id]
      );
    });

    // Atualiza grade
    await updateStudentGrade(req.user.id, submission.assignment_id);

    res.json({
      message: 'Atividade entregue com sucesso!',
      score: totalScore,
      percentual: Math.round(percentual),
      xpEarned
    });
  } catch (error) {
    logger.error('Submit error:', error);
    res.status(500).json({ error: 'Erro ao finalizar submissão' });
  }
});

// GET /api/submissions - Lista submissões
router.get('/', authenticate, async (req, res) => {
  try {
    const { assignmentId, studentId, status } = req.query;
    let sql = `
      SELECT s.*, a.title as assignment_title, a.type, a.max_score,
             u.display_name as student_name, u.minecraft_username
      FROM submissions s
      JOIN assignments a ON s.assignment_id = a.id
      JOIN users u ON s.student_id = u.id
      WHERE 1=1
    `;
    const params = [];

    if (req.user.role === 'student') {
      sql += ' AND s.student_id = ?';
      params.push(req.user.id);
    } else if (req.user.role === 'teacher') {
      sql += ' AND a.teacher_id = ?';
      params.push(req.user.id);
    }

    if (assignmentId) { sql += ' AND s.assignment_id = ?'; params.push(assignmentId); }
    if (studentId && req.user.role !== 'student') { sql += ' AND s.student_id = ?'; params.push(studentId); }
    if (status) { sql += ' AND s.status = ?'; params.push(status); }

    sql += ' ORDER BY s.submitted_at DESC LIMIT 200';

    const submissions = await db.query(sql, params);
    res.json(submissions);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar submissões' });
  }
});

// PUT /api/submissions/:id/grade - Professor avalia submissão aberta
router.put('/:id/grade', authenticate, authorize('teacher', 'admin'), async (req, res) => {
  try {
    const { score, feedback } = req.body;

    const submission = await db.queryOne('SELECT * FROM submissions WHERE id = ?', [req.params.id]);
    if (!submission) return res.status(404).json({ error: 'Submissão não encontrada' });

    const assignment = await db.queryOne('SELECT xp_reward FROM assignments WHERE id = ?', [submission.assignment_id]);
    const xpEarned = Math.round(assignment.xp_reward * (score / 100));

    await db.transaction(async (conn) => {
      await conn.query(
        `UPDATE submissions SET status = 'graded', score = ?, xp_earned = ?,
         graded_at = NOW(), graded_by = ?, feedback = ? WHERE id = ?`,
        [score, xpEarned, req.user.id, feedback, req.params.id]
      );

      await conn.query(
        `INSERT INTO xp_transactions (student_id, xp_amount, source_type, source_id, description)
         VALUES (?, ?, 'submission', ?, 'Atividade avaliada pelo professor')`,
        [submission.student_id, xpEarned, submission.assignment_id]
      );

      await conn.query(
        'UPDATE student_xp SET total_xp = total_xp + ? WHERE student_id = ?',
        [xpEarned, submission.student_id]
      );
    });

    // Notifica aluno
    await db.query(
      `INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, 'grade')`,
      [submission.student_id, '📊 Atividade Avaliada!',
       `Sua nota: ${score}/100. Feedback disponível no dashboard.`]
    );

    res.json({ message: 'Submissão avaliada com sucesso', xpEarned });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao avaliar submissão' });
  }
});

// Helper: Atualiza média do aluno
async function updateStudentGrade(studentId, assignmentId) {
  try {
    const assignment = await db.queryOne(
      'SELECT class_id, subject_id FROM assignments WHERE id = ?',
      [assignmentId]
    );
    if (!assignment) return;

    const avgResult = await db.queryOne(
      `SELECT AVG(s.score) as avg_score
       FROM submissions s
       JOIN assignments a ON s.assignment_id = a.id
       WHERE s.student_id = ? AND a.class_id = ? AND a.subject_id = ?
       AND s.status IN ('submitted', 'graded') AND s.score IS NOT NULL`,
      [studentId, assignment.class_id, assignment.subject_id]
    );

    if (avgResult?.avg_score !== null) {
      const year = new Date().getFullYear();
      const bimester = Math.ceil((new Date().getMonth() + 1) / 3);

      await db.query(
        `INSERT INTO grades (student_id, class_id, subject_id, bimester, academic_year, grade)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (student_id, class_id, subject_id, bimester, academic_year)
         DO UPDATE SET grade = EXCLUDED.grade`,
        [studentId, assignment.class_id, assignment.subject_id, bimester, year,
         parseFloat(avgResult.avg_score)]
      );
    }
  } catch (e) {
    logger.error('Update grade error:', e);
  }
}

module.exports = router;
