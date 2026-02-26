const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const logger = require('../config/logger');

// GET /api/assignments
router.get('/', authenticate, async (req, res) => {
  try {
    const { classId, subjectId, status, type } = req.query;
    const user = req.user;

    let sql = `
      SELECT a.*, c.name as class_name, s.name as subject_name, s.color as subject_color,
             u.display_name as teacher_name,
             (SELECT COUNT(*) FROM assignment_questions aq WHERE aq.assignment_id = a.id) as question_count,
             (SELECT COUNT(*) FROM submissions sub WHERE sub.assignment_id = a.id) as submission_count
      FROM assignments a
      JOIN classes c ON a.class_id = c.id
      JOIN subjects s ON a.subject_id = s.id
      JOIN users u ON a.teacher_id = u.id
      WHERE 1=1
    `;
    const params = [];

    if (user.role === 'teacher') {
      sql += ' AND a.teacher_id = ?'; params.push(user.id);
    } else if (user.role === 'student') {
      sql += ` AND a.class_id IN (SELECT class_id FROM class_students WHERE student_id = ?) AND a.status = 'published'`;
      params.push(user.id);
    }

    if (classId)   { sql += ' AND a.class_id = ?';  params.push(classId); }
    if (subjectId) { sql += ' AND a.subject_id = ?'; params.push(subjectId); }
    if (status)    { sql += ' AND a.status = ?';     params.push(status); }
    if (type)      { sql += ' AND a.type = ?';       params.push(type); }

    sql += ' ORDER BY a.created_at DESC LIMIT 100';
    const assignments = await db.query(sql, params);

    if (user.role === 'student') {
      for (const a of assignments) {
        a.submission = await db.queryOne(
          'SELECT id, status, score FROM submissions WHERE assignment_id = ? AND student_id = ?',
          [a.id, user.id]
        );
      }
    }

    res.json(assignments);
  } catch (error) {
    logger.error('Get assignments error:', error);
    res.status(500).json({ error: 'Erro ao buscar atividades' });
  }
});

// GET /api/assignments/:id
router.get('/:id', authenticate, async (req, res) => {
  try {
    const assignment = await db.queryOne(
      `SELECT a.*, c.name as class_name, s.name as subject_name, u.display_name as teacher_name
       FROM assignments a
       JOIN classes c ON a.class_id = c.id
       JOIN subjects s ON a.subject_id = s.id
       JOIN users u ON a.teacher_id = u.id
       WHERE a.id = ?`,
      [req.params.id]
    );
    if (!assignment) return res.status(404).json({ error: 'Atividade não encontrada' });

    // PostgreSQL: json_agg + json_build_object (substitui GROUP_CONCAT + JSON_OBJECT do MariaDB)
    const questions = await db.query(
      `SELECT q.*, aq.order_index, aq.points_override,
              COALESCE(
                json_agg(
                  json_build_object(
                    'id',         qo.id,
                    'letter',     qo.option_letter,
                    'content',    qo.content,
                    'is_correct', qo.is_correct,
                    'order',      qo.order_index
                  ) ORDER BY qo.order_index
                ) FILTER (WHERE qo.id IS NOT NULL),
                '[]'::json
              ) AS options
       FROM assignment_questions aq
       JOIN questions q ON aq.question_id = q.id
       LEFT JOIN question_options qo ON qo.question_id = q.id
       WHERE aq.assignment_id = ?
       GROUP BY q.id, aq.order_index, aq.points_override
       ORDER BY aq.order_index`,
      [req.params.id]
    );

    for (const q of questions) {
      // json_agg já retorna array — garante tipo correto
      if (!Array.isArray(q.options)) {
        q.options = typeof q.options === 'string' ? JSON.parse(q.options) : [];
      }
      // Esconder gabarito para alunos
      if (req.user.role === 'student') {
        q.options = q.options.map(o => ({ id: o.id, letter: o.letter, content: o.content }));
        delete q.correct_answer;
      }
    }
    assignment.questions = questions;

    res.json(assignment);
  } catch (error) {
    logger.error('Get assignment error:', error);
    res.status(500).json({ error: 'Erro ao buscar atividade' });
  }
});

// POST /api/assignments
router.post('/', authenticate, authorize('teacher', 'admin'), async (req, res) => {
  try {
    const {
      classId, subjectId, title, description, type, maxScore,
      xpReward, timeLimitMinutes, startsAt, endsAt, instructions, config, questionIds
    } = req.body;

    const result = await db.transaction(async (conn) => {
      const insertResult = await conn.insert(
        `INSERT INTO assignments (teacher_id, class_id, subject_id, title, description, type,
          max_score, xp_reward, time_limit_minutes, starts_at, ends_at, instructions, config)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [req.user.id, classId, subjectId, title, description, type,
         maxScore || 100, xpReward || 100, timeLimitMinutes || 0,
         startsAt || null, endsAt || null, instructions || null,
         config ? JSON.stringify(config) : null]
      );
      const assignmentId = insertResult.insertId;

      if (questionIds && questionIds.length > 0) {
        for (let i = 0; i < questionIds.length; i++) {
          await conn.query(
            'INSERT INTO assignment_questions (assignment_id, question_id, order_index) VALUES (?, ?, ?)',
            [assignmentId, questionIds[i], i]
          );
        }
      }
      return assignmentId;
    });

    res.status(201).json({ message: 'Atividade criada com sucesso', assignmentId: result });
  } catch (error) {
    logger.error('Create assignment error:', error);
    res.status(500).json({ error: 'Erro ao criar atividade' });
  }
});

// PUT /api/assignments/:id/publish
router.put('/:id/publish', authenticate, authorize('teacher', 'admin'), async (req, res) => {
  try {
    const assignment = await db.queryOne(
      'SELECT * FROM assignments WHERE id = ? AND teacher_id = ?',
      [req.params.id, req.user.id]
    );
    if (!assignment && req.user.role !== 'admin') {
      return res.status(404).json({ error: 'Atividade não encontrada' });
    }

    await db.query("UPDATE assignments SET status = 'published' WHERE id = ?", [req.params.id]);

    const students = await db.query(
      'SELECT student_id FROM class_students WHERE class_id = ?',
      [assignment.class_id]
    );
    for (const s of students) {
      await db.query(
        `INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, ?)`,
        [s.student_id, '📋 Nova Atividade!',
         `A atividade "${assignment.title}" foi publicada. Faça no Minecraft!`, 'assignment']
      );
    }

    res.json({ message: 'Atividade publicada com sucesso' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao publicar atividade' });
  }
});

// PUT /api/assignments/:id
router.put('/:id', authenticate, authorize('teacher', 'admin'), async (req, res) => {
  try {
    const { title, description, timeLimitMinutes, startsAt, endsAt, instructions, xpReward } = req.body;
    await db.query(
      `UPDATE assignments SET title = ?, description = ?, time_limit_minutes = ?,
       starts_at = ?, ends_at = ?, instructions = ?, xp_reward = ? WHERE id = ?`,
      [title, description, timeLimitMinutes, startsAt, endsAt, instructions, xpReward, req.params.id]
    );
    res.json({ message: 'Atividade atualizada' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao atualizar atividade' });
  }
});

// DELETE /api/assignments/:id
router.delete('/:id', authenticate, authorize('teacher', 'admin'), async (req, res) => {
  try {
    await db.query('DELETE FROM assignments WHERE id = ?', [req.params.id]);
    res.json({ message: 'Atividade removida' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao remover atividade' });
  }
});

module.exports = router;
