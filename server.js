/**
 * server.js
 * Secure Chat Server - main entrypoint.
 * Boots Express (REST API + static frontend), Socket.IO (real-time layer),
 * and MySQL (auto-creates database/tables on first run).
 */
const http = require('http');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const compression = require('compression');

const config = require('./config');
const logger = require('./utils/logger');
const { initDb } = require('./db');
const { initSocket } = require('./socket');
const { verifyCsrf } = require('./middlewares/csrf');
const { generalLimiter } = require('./middlewares/rateLimiter');
const { notFound, errorHandler } = require('./middlewares/errorHandler');
const userModel = require('./models/userModel');

const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const groupRoutes = require('./routes/groupRoutes');
const messageRoutes = require('./routes/messageRoutes');
const uploadRoutes = require('./routes/uploadRoutes');
const adminRoutes = require('./routes/adminRoutes');

async function bootstrapAdmin() {
  const existing = await userModel.findUserByUsername(config.admin.username);
  if (!existing) {
    await userModel.createUser({
      username: config.admin.username,
      password: config.admin.password,
      displayName: 'Administrator',
      role: 'admin',
    });
    logger.info(`Bootstrap admin account created: ${config.admin.username}`);
  }
}

async function start() {
  await initDb();
  logger.info('Database connected and schema verified.');

  await bootstrapAdmin();

  const app = express();
  app.set('trust proxy', 1); // required on Render/behind reverse proxies
  app.set('cookieSecure', config.cookie.secure);

  // ---------------------------------------------------------
  // Security middleware
  // ---------------------------------------------------------
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          imgSrc: ["'self'", 'data:', 'blob:'],
          mediaSrc: ["'self'", 'blob:'],
          connectSrc: ["'self'", ...config.clientOrigins],
        },
      },
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    })
  );

  app.use(
    cors({
      origin: config.clientOrigins,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
    })
  );

  app.use(compression());
  app.use(morgan(config.env === 'production' ? 'combined' : 'dev'));
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));
  app.use(cookieParser(config.cookie.secret));
  app.use(generalLimiter);

  // CSRF protection on all state-changing API routes (double-submit cookie)
  app.use('/api', verifyCsrf);

  // ---------------------------------------------------------
  // Static frontend + uploaded files
  // ---------------------------------------------------------
  app.use(express.static(path.join(__dirname, 'public')));
  app.use(
    '/uploads',
    express.static(path.join(__dirname, config.uploads.dir), {
      maxAge: '7d',
      setHeaders: (res) => res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin'),
    })
  );

  // ---------------------------------------------------------
  // API routes
  // ---------------------------------------------------------
  app.use('/api/auth', authRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/groups', groupRoutes);
  app.use('/api/messages', messageRoutes);
  app.use('/api/uploads', uploadRoutes);
  app.use('/api/admin', adminRoutes);

  app.get('/api/health', (req, res) => {
    res.json({ success: true, status: 'ok', timestamp: new Date().toISOString() });
  });

  // Frontend routes (SPA-ish, serve the relevant static page)
  app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
  app.get('/chat', (req, res) => res.sendFile(path.join(__dirname, 'public', 'chat.html')));
  app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

  app.use('/api', notFound);
  app.use(errorHandler);

  const server = http.createServer(app);
  initSocket(server);

  server.listen(config.port, () => {
    logger.info(`Secure Chat Server running on port ${config.port} [${config.env}]`);
    logger.info(`Local: http://localhost:${config.port}`);
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled Rejection', reason);
  });
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught Exception', err);
  });
}

start().catch((err) => {
  logger.error('Failed to start server', err);
  process.exit(1);
});
