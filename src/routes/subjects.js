// subjects.js
const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');
router.get('/', authenticate, async (req, res) => {
  try { res.json(await db.query('SELECT * FROM subjects WHERE is_active = TRUE ORDER BY name')); }
  catch (e) { res.status(500).json({ error: 'Erro ao buscar disciplinas' }); }
});
module.exports = router;
