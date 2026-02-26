const express = require('express');

// notifications.js
const notifRouter = express.Router();
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');

notifRouter.get('/', authenticate, async (req, res) => {
  try {
    res.json(await db.query(
      'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50',
      [req.user.id]
    ));
  } catch (e) { res.status(500).json({ error: 'Erro' }); }
});

notifRouter.put('/:id/read', authenticate, async (req, res) => {
  try {
    await db.query('UPDATE notifications SET is_read = TRUE WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Erro' }); }
});

notifRouter.put('/read-all', authenticate, async (req, res) => {
  try {
    await db.query('UPDATE notifications SET is_read = TRUE WHERE user_id = ?', [req.user.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Erro' }); }
});

module.exports = notifRouter;
