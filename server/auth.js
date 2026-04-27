const express = require('express');
const crypto = require('crypto');
const db = require('./database');

const router = express.Router();

// Generate a random session ID
function generateSessionId() {
  return crypto.randomBytes(32).toString('hex');
}

// Hash password with SHA-256
function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

// Clean expired sessions
function cleanExpiredSessions() {
  db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();
}

// ========================
// AUTH MIDDLEWARE
// ========================

function getSessionFromCookie(req) {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/session_id=([^;]+)/);
  return match ? match[1] : null;
}

function authMiddleware(req, res, next) {
  const sessionId = getSessionFromCookie(req);
  if (!sessionId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const session = db.prepare(`
    SELECT s.*, u.id as user_id, u.username, u.full_name, u.role, u.is_active
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.id = ? AND s.expires_at > datetime('now') AND u.is_active = 1
  `).get(sessionId);

  if (!session) {
    return res.status(401).json({ error: 'Session expired' });
  }

  req.user = {
    id: session.user_id,
    username: session.username,
    full_name: session.full_name,
    role: session.role,
  };
  next();
}

// ========================
// LOGIN
// ========================

router.post('/api/auth/login', (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const user = db.prepare('SELECT * FROM users WHERE username = ? AND is_active = 1').get(username);
    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const passwordHash = hashPassword(password);
    if (passwordHash !== user.password_hash) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    // Clean old sessions
    cleanExpiredSessions();

    // Create session (24 hour expiry)
    const sessionId = generateSessionId();
    db.prepare(`
      INSERT INTO sessions (id, user_id, expires_at)
      VALUES (?, ?, datetime('now', '+24 hours'))
    `).run(sessionId, user.id);

    // Update last login
    db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);

    // Set cookie
    res.setHeader('Set-Cookie',
      `session_id=${sessionId}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`
    );

    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        role: user.role,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========================
// LOGOUT
// ========================

router.post('/api/auth/logout', (req, res) => {
  const sessionId = getSessionFromCookie(req);
  if (sessionId) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
  }
  res.setHeader('Set-Cookie', 'session_id=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
  res.json({ success: true });
});

// ========================
// CHECK SESSION
// ========================

router.get('/api/auth/me', (req, res) => {
  const sessionId = getSessionFromCookie(req);
  if (!sessionId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const session = db.prepare(`
    SELECT u.id, u.username, u.full_name, u.role
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.id = ? AND s.expires_at > datetime('now') AND u.is_active = 1
  `).get(sessionId);

  if (!session) {
    return res.status(401).json({ error: 'Session expired' });
  }

  res.json({ user: session });
});

// ========================
// USER MANAGEMENT (admin only)
// ========================

router.get('/api/users', authMiddleware, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  try {
    const users = db.prepare('SELECT id, username, full_name, role, is_active, created_at, last_login FROM users ORDER BY created_at').all();
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/api/users', authMiddleware, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  try {
    const { username, password, full_name, role } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    const hash = hashPassword(password);
    const result = db.prepare(`
      INSERT INTO users (username, password_hash, full_name, role)
      VALUES (?, ?, ?, ?)
    `).run(username, hash, full_name || '', role || 'operator');

    const user = db.prepare('SELECT id, username, full_name, role, is_active, created_at FROM users WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(user);
  } catch (error) {
    if (error.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Username already exists' });
    }
    res.status(500).json({ error: error.message });
  }
});

router.delete('/api/users/:id', authMiddleware, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  try {
    if (parseInt(req.params.id) === req.user.id) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(req.params.id);
    db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/api/users/:id', authMiddleware, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  try {
    const { full_name, role, password, is_active } = req.body;
    const userId = parseInt(req.params.id);
    const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
    if (!existing) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Build update query dynamically
    const updates = [];
    const params = [];
    if (full_name !== undefined) { updates.push('full_name = ?'); params.push(full_name); }
    if (role !== undefined) { updates.push('role = ?'); params.push(role); }
    if (is_active !== undefined) { updates.push('is_active = ?'); params.push(is_active); }
    if (password) { updates.push('password_hash = ?'); params.push(hashPassword(password)); }

    if (updates.length > 0) {
      params.push(userId);
      db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    }

    const user = db.prepare('SELECT id, username, full_name, role, is_active, created_at, last_login FROM users WHERE id = ?').get(userId);
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

function logAction(userId, action, details, ip = '') {
  try {
    db.prepare(`
      INSERT INTO audit_logs (user_id, action, details, ip_address)
      VALUES (?, ?, ?, ?)
    `).run(userId, action, details, ip);
  } catch (err) {
    console.error('[AuditLog] Failed to record action:', err);
  }
}

module.exports = { router, authMiddleware, logAction };
