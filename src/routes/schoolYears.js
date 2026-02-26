const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');

// GET /api/school-years
router.get('/', authenticate, async (req, res) => {
  try {
    const rows = await db.query(
      'SELECT * FROM school_years WHERE is_active = TRUE ORDER BY level, year_number'
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'Erro ao buscar séries' });
  }
});

module.exports = router;
