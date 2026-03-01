require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const { createServer } = require('http');
const logger = require('./config/logger');
const db = require('./config/database');
const wsManager = require('./websocket/wsManager');

// Routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const classRoutes = require('./routes/classes');
const subjectRoutes = require('./routes/subjects');
const questionRoutes = require('./routes/questions');
const assignmentRoutes = require('./routes/assignments');
const submissionRoutes = require('./routes/submissions');
const gradeRoutes = require('./routes/grades');
const xpRoutes = require('./routes/xp');
const dashboardRoutes = require('./routes/dashboard');
const minecraftRoutes = require('./routes/minecraft');
const codeRoutes = require('./routes/code');
const designRoutes = require('./routes/design');
const notificationRoutes = require('./routes/notifications');
const reportRoutes = require('./routes/reports');
const schoolYearsRoutes = require('./routes/schoolYears');
const linkRoutes         = require('./routes/link');

const app = express();
const httpServer = createServer(app);

// ============================================================
// MIDDLEWARE
// ============================================================
app.use(helmet());
app.use(compression());
app.use(morgan('combined', { stream: { write: msg => logger.info(msg.trim()) } }));
const allowedOrigins = [
  process.env.FRONTEND_URL,
  'http://localhost:3000',
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Permite requests sem origin (mobile apps, curl, Minecraft plugin)
    if (!origin) return callback(null, true);
    if (allowedOrigins.some(o => origin.startsWith(o))) return callback(null, true);
    // Permite qualquer subdomínio do Vercel
    if (origin.endsWith('.vercel.app')) return callback(null, true);
    callback(new Error('CORS não permitido: ' + origin));
  },
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static('uploads'));

// Rate Limiting
const rateLimit = require('express-rate-limit');
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000,
  max: parseInt(process.env.RATE_LIMIT_MAX) || 100,
  message: { error: 'Muitas requisições. Tente novamente em breve.' }
});
app.use('/api/', limiter);

// Auth rate limiter (mais restritivo)
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });

// ============================================================
// ROUTES
// ============================================================
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/classes', classRoutes);
app.use('/api/subjects', subjectRoutes);
app.use('/api/questions', questionRoutes);
app.use('/api/assignments', assignmentRoutes);
app.use('/api/submissions', submissionRoutes);
app.use('/api/grades', gradeRoutes);
app.use('/api/xp', xpRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/minecraft', minecraftRoutes);
app.use('/api/code', codeRoutes);
app.use('/api/design', designRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/school-years', schoolYearsRoutes);
app.use('/api/link',         linkRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    name: 'CraftMind Nexus API',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Rota não encontrada' });
});

// Error handler
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', err);
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production'
      ? 'Erro interno do servidor'
      : err.message
  });
});

// ============================================================
// START SERVER
// ============================================================
const PORT = process.env.PORT || 3001;

async function startServer() {
  try {
    await db.connect();
    logger.info('✅ Banco de dados conectado');

    httpServer.listen(PORT, () => {
      logger.info(`🚀 CraftMind Nexus API rodando na porta ${PORT}`);
    });

    wsManager.init(httpServer);
    logger.info(`🔌 WebSocket inicializado`);

  } catch (error) {
    logger.error('❌ Erro ao iniciar servidor:', error);
    process.exit(1);
  }
}

startServer();

module.exports = app;
