const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { minecraftAuth } = require('../middleware/auth');
const wsManager = require('../websocket/wsManager');
const logger = require('../config/logger');

// Todas as rotas precisam de API Key do plugin

// POST /api/minecraft/auth - Plugin autentica jogador pelo UUID
router.post('/auth', minecraftAuth, async (req, res) => {
  try {
    const { minecraftUuid, minecraftUsername } = req.body;

    let user = await db.queryOne(
      `SELECT u.id, u.username, u.display_name, u.is_active, r.name as role
       FROM users u JOIN roles r ON u.role_id = r.id
       WHERE u.minecraft_uuid = ? OR u.minecraft_username = ?`,
      [minecraftUuid, minecraftUsername]
    );

    if (!user) {
      return res.status(404).json({ authenticated: false, message: 'Jogador não vinculado ao sistema' });
    }

    if (!user.is_active) {
      return res.status(403).json({ authenticated: false, message: 'Conta desativada' });
    }

    // Atualiza UUID se necessário
    await db.query(
      'UPDATE users SET minecraft_uuid = ?, minecraft_username = ? WHERE id = ?',
      [minecraftUuid, minecraftUsername, user.id]
    );

    // Registra sessão
    await db.query(
      `INSERT INTO minecraft_sessions (user_id, minecraft_uuid) VALUES (?, ?)`,
      [user.id, minecraftUuid]
    );

    res.json({
      authenticated: true,
      userId: user.id,
      username: user.username,
      displayName: user.display_name,
      role: user.role
    });
  } catch (error) {
    logger.error('MC Auth error:', error);
    res.status(500).json({ error: 'Erro na autenticação' });
  }
});

// POST /api/minecraft/disconnect
router.post('/disconnect', minecraftAuth, async (req, res) => {
  try {
    const { minecraftUuid } = req.body;
    await db.query(
      `UPDATE minecraft_sessions SET left_at = NOW(), is_active = FALSE
       WHERE minecraft_uuid = ? AND is_active = TRUE`,
      [minecraftUuid]
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao registrar desconexão' });
  }
});

// GET /api/minecraft/assignments/:userId - Lista atividades disponíveis no MC
router.get('/assignments/:userId', minecraftAuth, async (req, res) => {
  try {
    const { userId } = req.params;

    const assignments = await db.query(
      `SELECT a.id, a.title, a.type, a.time_limit_minutes, a.xp_reward,
              s.name as subject_name, s.color as subject_color,
              sub.status as submission_status, sub.score
       FROM assignments a
       JOIN class_students cs ON cs.class_id = a.class_id
       JOIN subjects s ON a.subject_id = s.id
       LEFT JOIN submissions sub ON sub.assignment_id = a.id AND sub.student_id = ?
       WHERE cs.student_id = ? AND a.status = 'published'
       AND (a.ends_at IS NULL OR a.ends_at > NOW())
       ORDER BY a.created_at DESC`,
      [userId, userId]
    );

    res.json(assignments);
  } catch (error) {
    logger.error('MC assignments error:', error);
    res.status(500).json({ error: 'Erro ao buscar atividades' });
  }
});

// GET /api/minecraft/assignment/:id/questions - Questões para o MC
router.get('/assignment/:id/questions', minecraftAuth, async (req, res) => {
  try {
    const { userId } = req.query;

    // Verifica acesso
    const assignment = await db.queryOne(
      `SELECT a.* FROM assignments a
       JOIN class_students cs ON cs.class_id = a.class_id
       WHERE a.id = ? AND cs.student_id = ? AND a.status = 'published'`,
      [req.params.id, userId]
    );

    if (!assignment) return res.status(404).json({ error: 'Atividade não encontrada' });

    const questions = await db.query(
      `SELECT q.id, q.title, q.content, q.question_type, q.difficulty, q.points, q.time_limit_seconds
       FROM assignment_questions aq
       JOIN questions q ON aq.question_id = q.id
       WHERE aq.assignment_id = ?
       ORDER BY aq.order_index`,
      [req.params.id]
    );

    for (const q of questions) {
      if (q.question_type === 'multiple_choice') {
        q.options = await db.query(
          'SELECT option_letter, content FROM question_options WHERE question_id = ? ORDER BY order_index',
          [q.id]
        );
      }
    }

    res.json({
      assignment: {
        id: assignment.id,
        title: assignment.title,
        type: assignment.type,
        timeLimitMinutes: assignment.time_limit_minutes,
        xpReward: assignment.xp_reward
      },
      questions
    });
  } catch (error) {
    logger.error('MC questions error:', error);
    res.status(500).json({ error: 'Erro ao buscar questões' });
  }
});

// POST /api/minecraft/submit - Plugin envia resposta de questão
router.post('/submit', minecraftAuth, async (req, res) => {
  try {
    const { userId, assignmentId, questionId, selectedOption, answerText, timeSpent } = req.body;

    // Encontra/cria submissão
    let submission = await db.queryOne(
      'SELECT id FROM submissions WHERE assignment_id = ? AND student_id = ?',
      [assignmentId, userId]
    );

    if (!submission) {
      const result = await db.insert(
        `INSERT INTO submissions (assignment_id, student_id, status) VALUES (?, ?, 'in_progress')`,
        [assignmentId, userId]
      );
      submission = { id: result.insertId };
    }

    // Busca resposta correta
    const question = await db.queryOne('SELECT * FROM questions WHERE id = ?', [questionId]);
    let isCorrect = null;
    let scoreEarned = 0;

    if (question.question_type === 'multiple_choice' || question.question_type === 'true_false') {
      const correctOpt = await db.queryOne(
        'SELECT option_letter, content FROM question_options WHERE question_id = ? AND is_correct = TRUE',
        [questionId]
      );

      isCorrect = correctOpt?.option_letter === selectedOption;

      const aq = await db.queryOne(
        'SELECT points_override FROM assignment_questions WHERE assignment_id = ? AND question_id = ?',
        [assignmentId, questionId]
      );
      const points = aq?.points_override || question.points;
      scoreEarned = isCorrect ? parseFloat(points) : 0;

      await db.query(
        `INSERT INTO submission_answers (submission_id, question_id, selected_option, is_correct, score_earned)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (submission_id, question_id)
         DO UPDATE SET selected_option = EXCLUDED.selected_option,
                       is_correct = EXCLUDED.is_correct,
                       score_earned = EXCLUDED.score_earned`,
        [submission.id, questionId, selectedOption, isCorrect, scoreEarned,
         selectedOption, isCorrect, scoreEarned]
      );

      res.json({
        correct: isCorrect,
        scoreEarned,
        correctOption: correctOpt?.option_letter,
        correctContent: isCorrect ? null : correctOpt?.content,
        explanation: question.explanation
      });
    } else {
      // Questão aberta - salva para avaliação do professor
      await db.query(
        `INSERT INTO submission_answers (submission_id, question_id, answer_text)
         VALUES (?, ?, ?)
         ON CONFLICT (submission_id, question_id)
         DO UPDATE SET answer_text = EXCLUDED.answer_text`,
        [submission.id, questionId, answerText]
      );
      res.json({ queued: true, message: 'Resposta enviada para avaliação do professor' });
    }
  } catch (error) {
    logger.error('MC submit error:', error);
    res.status(500).json({ error: 'Erro ao registrar resposta' });
  }
});

// POST /api/minecraft/finish - Finaliza prova
router.post('/finish', minecraftAuth, async (req, res) => {
  try {
    const { userId, assignmentId, timeSpentSeconds } = req.body;

    const submission = await db.queryOne(
      `SELECT s.*, a.xp_reward, a.max_score FROM submissions s
       JOIN assignments a ON s.assignment_id = a.id
       WHERE s.assignment_id = ? AND s.student_id = ? AND s.status = 'in_progress'`,
      [assignmentId, userId]
    );

    if (!submission) return res.status(404).json({ error: 'Submissão não encontrada' });

    const scoreResult = await db.queryOne(
      'SELECT COALESCE(SUM(score_earned), 0) as total FROM submission_answers WHERE submission_id = ?',
      [submission.id]
    );

    const totalScore = parseFloat(scoreResult.total);
    const percentual = (totalScore / submission.max_score) * 100;
    const xpEarned = Math.round(submission.xp_reward * (percentual / 100));

    await db.transaction(async (conn) => {
      await conn.query(
        `UPDATE submissions SET status = 'submitted', score = ?, xp_earned = ?,
         submitted_at = NOW(), time_spent_seconds = ? WHERE id = ?`,
        [totalScore, xpEarned, timeSpentSeconds || 0, submission.id]
      );

      await conn.query(
        `INSERT INTO xp_transactions (student_id, xp_amount, source_type, source_id, description)
         VALUES (?, ?, 'submission', ?, ?)`,
        [userId, xpEarned, assignmentId, `Prova finalizada - ${Math.round(percentual)}%`]
      );

      await conn.query(
        'UPDATE student_xp SET total_xp = total_xp + ? WHERE student_id = ?',
        [xpEarned, userId]
      );
    });

    // Notifica via WebSocket pro dashboard
    wsManager.notifyUser(userId, {
      type: 'SUBMISSION_COMPLETE',
      score: totalScore,
      percentual: Math.round(percentual),
      xpEarned
    });

    res.json({
      success: true,
      score: totalScore,
      percentual: Math.round(percentual),
      xpEarned,
      message: `Parabéns! Você ganhou ${xpEarned} XP!`
    });
  } catch (error) {
    logger.error('MC finish error:', error);
    res.status(500).json({ error: 'Erro ao finalizar prova' });
  }
});

// POST /api/minecraft/design/save - Salva pixel art
router.post('/design/save', minecraftAuth, async (req, res) => {
  try {
    const { userId, assignmentId, canvasData } = req.body;

    let submission = await db.queryOne(
      'SELECT id FROM submissions WHERE assignment_id = ? AND student_id = ?',
      [assignmentId, userId]
    );

    if (!submission) {
      const result = await db.insert(
        `INSERT INTO submissions (assignment_id, student_id, status) VALUES (?, ?, 'in_progress')`,
        [assignmentId, userId]
      );
      submission = { id: result.insertId };
    }

    // Upsert design
    await db.query(
      `INSERT INTO design_submissions (submission_id, canvas_data) VALUES (?, ?)
       ON CONFLICT (submission_id)
       DO UPDATE SET canvas_data = EXCLUDED.canvas_data`,
      [submission.id, JSON.stringify(canvasData)]
    );

    res.json({ success: true, message: 'PixelArt salvo!' });
  } catch (error) {
    logger.error('MC design save error:', error);
    res.status(500).json({ error: 'Erro ao salvar design' });
  }
});

// POST /api/minecraft/design/submit - Envia pixel art
router.post('/design/submit', minecraftAuth, async (req, res) => {
  try {
    const { userId, assignmentId } = req.body;

    const submission = await db.queryOne(
      'SELECT * FROM submissions WHERE assignment_id = ? AND student_id = ?',
      [assignmentId, userId]
    );

    if (!submission) return res.status(404).json({ error: 'Design não encontrado. Salve primeiro!' });

    await db.query(
      `UPDATE submissions SET status = 'submitted', submitted_at = NOW() WHERE id = ?`,
      [submission.id]
    );

    res.json({ success: true, message: 'Design enviado para avaliação!' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao enviar design' });
  }
});

// POST /api/minecraft/code/submit - Envia código para execução
router.post('/code/submit', minecraftAuth, async (req, res) => {
  try {
    const { userId, assignmentId, language, sourceCode, questionId } = req.body;

    let submission = await db.queryOne(
      'SELECT id FROM submissions WHERE assignment_id = ? AND student_id = ?',
      [assignmentId, userId]
    );

    if (!submission) {
      const result = await db.insert(
        `INSERT INTO submissions (assignment_id, student_id, status) VALUES (?, ?, 'in_progress')`,
        [assignmentId, userId]
      );
      submission = { id: result.insertId };
    }

    const question = await db.queryOne('SELECT * FROM questions WHERE id = ?', [questionId]);

    // Salva código
    const codeResult = await db.insert(
      `INSERT INTO code_submissions (submission_id, language, source_code, expected_output, compile_status, run_status)
       VALUES (?, ?, ?, ?, 'pending', 'pending')`,
      [submission.id, language, sourceCode, question?.config?.expectedOutput || null]
    );

    const codeSubId = codeResult.insertId;

    // Executa via sandbox (async)
    executeCode(codeSubId, language, sourceCode, question).catch(e => logger.error('Code exec error:', e));

    res.json({
      codeSubmissionId: codeSubId,
      message: 'Código enviado! Aguardando execução...'
    });
  } catch (error) {
    logger.error('Code submit error:', error);
    res.status(500).json({ error: 'Erro ao enviar código' });
  }
});

// GET /api/minecraft/code/:id/result - Resultado de execução
router.get('/code/:id/result', minecraftAuth, async (req, res) => {
  try {
    const result = await db.queryOne(
      `SELECT compile_status, run_status, actual_output, error_message, execution_time_ms, memory_used_kb
       FROM code_submissions WHERE id = ?`,
      [req.params.id]
    );

    if (!result) return res.status(404).json({ error: 'Não encontrado' });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar resultado' });
  }
});

// Helper: Executa código via Piston API
async function executeCode(codeSubId, language, sourceCode, question) {
  const axios = require('axios');
  const langMap = { javascript: 'javascript', python: 'python3', java: 'java' };

  try {
    const response = await axios.post(`${process.env.SANDBOX_API_URL}/execute`, {
      language: langMap[language] || language,
      version: '*',
      files: [{ content: sourceCode }],
      stdin: question?.config?.stdin || '',
      args: [],
      compile_timeout: 10000,
      run_timeout: 5000,
      compile_memory_limit: -1,
      run_memory_limit: -1
    });

    const { run, compile } = response.data;
    const output = run?.stdout || '';
    const stderr = run?.stderr || compile?.stderr || '';
    const hasError = run?.code !== 0 || !!stderr;

    const expected = question?.config?.expectedOutput;
    const correct = expected ? output.trim() === expected.trim() : null;

    await db.query(
      `UPDATE code_submissions SET
       compile_status = ?, run_status = ?, actual_output = ?,
       error_message = ?, execution_time_ms = ?
       WHERE id = ?`,
      [
        compile?.code === 0 || !compile ? 'success' : 'error',
        hasError ? 'error' : (correct === false ? 'wrong_answer' : 'success'),
        output.substring(0, 10000),
        stderr.substring(0, 5000) || null,
        run?.time ? Math.round(run.time) : null,
        codeSubId
      ]
    );
  } catch (error) {
    await db.query(
      `UPDATE code_submissions SET compile_status = 'error', run_status = 'error',
       error_message = ? WHERE id = ?`,
      [error.message, codeSubId]
    );
  }
}

module.exports = router;
