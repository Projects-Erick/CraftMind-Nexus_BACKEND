const express = require('express');
const router = express.Router();
const axios = require('axios');
const { authenticate, authorize } = require('../middleware/auth');

// POST /api/code/execute - Executa código sandbox (para web editor)
router.post('/execute', authenticate, authorize('teacher', 'admin'), async (req, res) => {
  try {
    const { language, code, stdin = '' } = req.body;

    const langMap = { javascript: 'javascript', python: 'python3', java: 'java' };
    const pistonLang = langMap[language];

    if (!pistonLang) return res.status(400).json({ error: 'Linguagem não suportada' });

    const response = await axios.post(`${process.env.SANDBOX_API_URL}/execute`, {
      language: pistonLang,
      version: '*',
      files: [{ content: code }],
      stdin,
      run_timeout: 10000,
      compile_timeout: 15000
    }, { timeout: 30000 });

    const { run, compile } = response.data;
    res.json({
      output: run?.stdout || '',
      stderr: run?.stderr || compile?.stderr || '',
      exitCode: run?.code,
      time: run?.time
    });
  } catch (e) {
    res.status(500).json({ error: 'Erro ao executar código', details: e.message });
  }
});

module.exports = router;
