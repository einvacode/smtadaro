const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'data', 'monitor.db');

// Ensure data directory exists
const fs = require('fs');
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(dbPath);

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    ip_address TEXT NOT NULL UNIQUE,
    location TEXT DEFAULT '',
    device_type TEXT DEFAULT 'NVR',
    channel_count INTEGER DEFAULT 0,
    description TEXT DEFAULT '',
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS ping_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id INTEGER NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('online', 'offline', 'timeout')),
    response_time REAL DEFAULT NULL,
    checked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id INTEGER NOT NULL,
    alert_type TEXT NOT NULL CHECK(alert_type IN ('down', 'recovered', 'high_latency')),
    message TEXT NOT NULL,
    is_read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    full_name TEXT DEFAULT '',
    role TEXT DEFAULT 'operator' CHECK(role IN ('admin', 'operator', 'viewer')),
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_login DATETIME
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_ping_logs_device_id ON ping_logs(device_id);
  CREATE INDEX IF NOT EXISTS idx_ping_logs_checked_at ON ping_logs(checked_at);
  CREATE INDEX IF NOT EXISTS idx_alerts_device_id ON alerts(device_id);
  CREATE INDEX IF NOT EXISTS idx_alerts_created_at ON alerts(created_at);
  CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    action TEXT NOT NULL,
    details TEXT,
    ip_address TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
  );
`);

// Seed initial log if empty
const logCount = db.prepare('SELECT COUNT(*) as c FROM audit_logs').get().c;
if (logCount === 0) {
  db.prepare("INSERT INTO audit_logs (action, details) VALUES (?, ?)").run('System Init', 'Database schema initialized');
}

// Seed default settings if empty
const settingsCount = db.prepare('SELECT COUNT(*) as c FROM settings').get().c;
if (settingsCount === 0) {
  const defaults = {
    app_name: 'MarineCCTV',
    hero_title_1: 'Maritime CCTV',
    hero_title_2: 'Infrastructure Monitoring',
    hero_description: 'Platform monitoring real-time untuk infrastruktur CCTV dan NVR di lingkungan pelabuhan dan maritim. Pantau uptime, latency, dan status seluruh perangkat surveillance dari satu dashboard terpadu.',
    hero_badge: 'MONITORING SYSTEM ACTIVE',
    cta_title: 'Mulai Monitoring Sekarang',
    cta_description: 'Akses dashboard untuk memantau seluruh infrastruktur CCTV dan NVR Anda secara real-time.',
    footer_text: '© 2026 MarineCCTV Monitoring System — Maritime Surveillance Infrastructure',
    logo_path: '',
  };
  const insert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(defaults)) {
    insert.run(k, v);
  }
  console.log('[Database] Default settings seeded');
}

// Seed default admin user if none exists
const crypto = require('crypto');
const existingAdmin = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
if (!existingAdmin) {
  const hash = crypto.createHash('sha256').update('admin123').digest('hex');
  db.prepare(`
    INSERT INTO users (username, password_hash, full_name, role)
    VALUES (?, ?, ?, ?)
  `).run('admin', hash, 'Administrator', 'admin');
  console.log('[Database] Default admin user created (admin / admin123)');
}

module.exports = db;
