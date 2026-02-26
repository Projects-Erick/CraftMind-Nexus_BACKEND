const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

// GET /api/questions
router.get('/', authenticate, authorize('teacher', 'admin', 'secretary'), async (req, res) => {
  try {
    const { subjectId, schoolYearId, difficulty, type, search } = req.query;

    let sql = `
      SELECT q.*, s.name as subject_name, sy.name as year_name,
             u.display_name as teacher_name,
             (SELECT COUNT(*) FROM question_options qo WHERE qo.question_id = q.id) as options_count
      FROM questions q
      JOIN subjects s ON q.subject_id = s.id
      JOIN school_years sy ON q.school_year_id = sy.id
      JOIN users u ON q.teacher_id = u.id
      WHERE q.is_active = TRUE
    `;
    const params = [];

    if (req.user.role === 'teacher') {
      sql += ' AND q.teacher_id = ?';
      params.push(req.user.id);
    }
    if (subjectId) { sql += ' AND q.subject_id = ?'; params.push(subjectId); }
    if (schoolYearId) { sql += ' AND q.school_year_id = ?'; params.push(schoolYearId); }
    if (difficulty) { sql += ' AND q.difficulty = ?'; params.push(difficulty); }
    if (type) { sql += ' AND q.question_type = ?'; params.push(type); }
    if (search) { sql += ' AND (q.title LIKE ? OR q.content LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }

    sql += ' ORDER BY q.created_at DESC LIMIT 200';

    const questions = await db.query(sql, params);
    res.json(questions);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar questões' });
  }
});

// GET /api/questions/:id
router.get('/:id', authenticate, authorize('teacher', 'admin'), async (req, res) => {
  try {
    const question = await db.queryOne(
      `SELECT q.*, s.name as subject_name, sy.name as year_name
       FROM questions q
       JOIN subjects s ON q.subject_id = s.id
       JOIN school_years sy ON q.school_year_id = sy.id
       WHERE q.id = ?`,
      [req.params.id]
    );

    if (!question) return res.status(404).json({ error: 'Questão não encontrada' });

    question.options = await db.query(
      'SELECT * FROM question_options WHERE question_id = ? ORDER BY order_index',
      [req.params.id]
    );

    res.json(question);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar questão' });
  }
});

// POST /api/questions
router.post('/', authenticate, authorize('teacher', 'admin'), async (req, res) => {
  try {
    const {
      subjectId, schoolYearId, title, content, questionType,
      difficulty, points, timeLimitSeconds, explanation, tags, options
    } = req.body;

    const result = await db.transaction(async (conn) => {
      const insertResult = await conn.insert(
        `INSERT INTO questions (teacher_id, subject_id, school_year_id, title, content,
          question_type, difficulty, points, time_limit_seconds, explanation, tags)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [req.user.id, subjectId, schoolYearId, title, content,
         questionType, difficulty, points || 10, timeLimitSeconds || 0,
         explanation || null, tags ? JSON.stringify(tags) : null]
      );

      const questionId = insertResult.insertId;

      // Inserir opções para múltipla escolha
      if (options && options.length > 0) {
        for (let i = 0; i < options.length; i++) {
          const opt = options[i];
          await conn.query(
            `INSERT INTO question_options (question_id, option_letter, content, is_correct, order_index)
             VALUES (?, ?, ?, ?, ?)`,
            [questionId, opt.letter, opt.content, opt.isCorrect || false, i]
          );
        }
      }

      return questionId;
    });

    res.status(201).json({ message: 'Questão criada com sucesso', questionId: result });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao criar questão' });
  }
});

// PUT /api/questions/:id
router.put('/:id', authenticate, authorize('teacher', 'admin'), async (req, res) => {
  try {
    const { title, content, difficulty, points, explanation, options } = req.body;

    await db.transaction(async (conn) => {
      await conn.query(
        `UPDATE questions SET title = ?, content = ?, difficulty = ?, points = ?, explanation = ? WHERE id = ?`,
        [title, content, difficulty, points, explanation, req.params.id]
      );

      if (options) {
        await conn.query('DELETE FROM question_options WHERE question_id = ?', [req.params.id]);
        for (let i = 0; i < options.length; i++) {
          const opt = options[i];
          await conn.query(
            `INSERT INTO question_options (question_id, option_letter, content, is_correct, order_index)
             VALUES (?, ?, ?, ?, ?)`,
            [req.params.id, opt.letter, opt.content, opt.isCorrect || false, i]
          );
        }
      }
    });

    res.json({ message: 'Questão atualizada com sucesso' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao atualizar questão' });
  }
});

// DELETE /api/questions/:id
router.delete('/:id', authenticate, authorize('teacher', 'admin'), async (req, res) => {
  try {
    await db.query('UPDATE questions SET is_active = FALSE WHERE id = ?', [req.params.id]);
    res.json({ message: 'Questão removida' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao remover questão' });
  }
});

module.exports = router;
