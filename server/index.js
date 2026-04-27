const express = require('express');
const cors = require('cors');
const path = require('path');
const routes = require('./routes');
const { router: authRouter, authMiddleware } = require('./auth');
const { startMonitoring, cleanOldLogs } = require('./pingService');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3099;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ========================
// PUBLIC ROUTES (no auth)
// ========================

// Landing page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'landing.html'));
});

// Login page
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'login.html'));
});

// Public settings API (for landing page, no auth)
app.get('/api/public/settings', (req, res) => {
  try {
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const settings = {};
    rows.forEach(r => { settings[r.key] = r.value; });
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Auth API routes (login, logout, check session)
app.use(authRouter);

// Serve static files (CSS, JS, images, fonts) — after explicit routes, no index fallback
app.use(express.static(path.join(__dirname, '..', 'public'), { index: false }));

// ========================
// PROTECTED ROUTES (auth required)
// ========================

// Dashboard page — check session via cookie
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Protect all API routes
app.use('/api', authMiddleware);
app.use(routes);

// Start server
app.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════════════╗
  ║   Marine CCTV Dashboard Monitoring System    ║
  ║   Server running on http://localhost:${PORT}    ║
  ╚══════════════════════════════════════════════╝
  `);

  // Start ping monitoring (every 30 seconds)
  startMonitoring(30000);

  // Clean old logs every 6 hours
  setInterval(cleanOldLogs, 6 * 60 * 60 * 1000);

  // Auto-scheduled backup every 24 hours
  setInterval(async () => {
    try {
      const fs = require('fs');
      const BACKUP_DIR = path.join(__dirname, '..', 'data', 'backups');
      if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

      const now = new Date();
      const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const filename = `backup_${timestamp}_Auto-Scheduled.db`;
      const backupPath = path.join(BACKUP_DIR, filename);

      await db.backup(backupPath);
      console.log(`[AutoBackup] Daily scheduled backup created: ${filename}`);
      
      // Optional: Add audit log for system action
      const { logAction } = require('./auth');
      logAction(null, 'Auto Backup', `System created scheduled backup: ${filename}`, '127.0.0.1');

    } catch (err) {
      console.error('[AutoBackup] Scheduled backup failed:', err);
    }
  }, 24 * 60 * 60 * 1000);
});
