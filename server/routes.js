const express = require('express');
const db = require('./database');
const { pingDevice, pingAllDevices } = require('./pingService');
const { logAction } = require('./auth');

const router = express.Router();

// ========================
// DEVICE MANAGEMENT
// ========================

// Get all devices with their latest ping status
router.get('/api/devices', (req, res) => {
  try {
    const devices = db.prepare(`
      SELECT d.*, 
        (SELECT pl.status FROM ping_logs pl WHERE pl.device_id = d.id ORDER BY pl.checked_at DESC LIMIT 1) as last_status,
        (SELECT pl.response_time FROM ping_logs pl WHERE pl.device_id = d.id ORDER BY pl.checked_at DESC LIMIT 1) as last_response_time,
        (SELECT pl.checked_at FROM ping_logs pl WHERE pl.device_id = d.id ORDER BY pl.checked_at DESC LIMIT 1) as last_checked
      FROM devices d
      ORDER BY d.name
    `).all();
    res.json(devices);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add a new device
router.post('/api/devices', (req, res) => {
  try {
    const { name, ip_address, location, device_type, channel_count, description } = req.body;

    if (!name || !ip_address) {
      return res.status(400).json({ error: 'Name and IP address are required' });
    }

    const result = db.prepare(`
      INSERT INTO devices (name, ip_address, location, device_type, channel_count, description)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(name, ip_address, location || '', device_type || 'NVR', channel_count || 0, description || '');

    const device = db.prepare('SELECT * FROM devices WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(device);
  } catch (error) {
    if (error.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'A device with this IP address already exists' });
    }
    res.status(500).json({ error: error.message });
  }
});

// Update a device
router.put('/api/devices/:id', (req, res) => {
  try {
    const { name, ip_address, location, device_type, channel_count, description, is_active } = req.body;
    const { id } = req.params;

    db.prepare(`
      UPDATE devices SET name = ?, ip_address = ?, location = ?, device_type = ?, 
      channel_count = ?, description = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(name, ip_address, location, device_type, channel_count, description, is_active, id);

    const device = db.prepare('SELECT * FROM devices WHERE id = ?').get(id);
    res.json(device);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete a device
router.delete('/api/devices/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM devices WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Manual ping a specific device
router.post('/api/devices/:id/ping', async (req, res) => {
  try {
    const device = db.prepare('SELECT * FROM devices WHERE id = ?').get(req.params.id);
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }
    const result = await pingDevice(device);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Manual ping all devices
router.post('/api/devices/ping-all', async (req, res) => {
  try {
    const results = await pingAllDevices();
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========================
// DASHBOARD STATS
// ========================

router.get('/api/dashboard/stats', (req, res) => {
  try {
    const totalDevices = db.prepare('SELECT COUNT(*) as count FROM devices WHERE is_active = 1').get().count;

    // Get latest status for each device
    const deviceStatuses = db.prepare(`
      SELECT d.id,
        (SELECT pl.status FROM ping_logs pl WHERE pl.device_id = d.id ORDER BY pl.checked_at DESC LIMIT 1) as status
      FROM devices d WHERE d.is_active = 1
    `).all();

    const onlineCount = deviceStatuses.filter(d => d.status === 'online').length;
    const offlineCount = deviceStatuses.filter(d => d.status !== 'online' && d.status !== null).length;
    const unknownCount = deviceStatuses.filter(d => d.status === null).length;

    // Average response time (last hour)
    const avgResponseTime = db.prepare(`
      SELECT AVG(response_time) as avg_rt 
      FROM ping_logs 
      WHERE status = 'online' AND checked_at > datetime('now', '-1 hour')
    `).get().avg_rt;

    // Uptime percentage (last 24 hours)
    const last24h = db.prepare(`
      SELECT 
        COUNT(CASE WHEN status = 'online' THEN 1 END) as online_count,
        COUNT(*) as total_count
      FROM ping_logs
      WHERE checked_at > datetime('now', '-24 hours')
    `).get();

    const uptimePercent = last24h.total_count > 0
      ? ((last24h.online_count / last24h.total_count) * 100).toFixed(2)
      : 0;

    // Unread alerts
    const unreadAlerts = db.prepare('SELECT COUNT(*) as count FROM alerts WHERE is_read = 0').get().count;

    res.json({
      totalDevices,
      onlineCount,
      offlineCount,
      unknownCount,
      avgResponseTime: avgResponseTime ? parseFloat(avgResponseTime.toFixed(2)) : 0,
      uptimePercent: parseFloat(uptimePercent),
      unreadAlerts,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========================
// PING HISTORY
// ========================

// Get ping history for a specific device
router.get('/api/devices/:id/history', (req, res) => {
  try {
    const { hours = 24 } = req.query;
    const logs = db.prepare(`
      SELECT status, response_time, checked_at
      FROM ping_logs
      WHERE device_id = ? AND checked_at > datetime('now', '-${parseInt(hours)} hours')
      ORDER BY checked_at DESC
      LIMIT 500
    `).all(req.params.id);
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get uptime stats per device (last 24h, 7d, 30d)
router.get('/api/devices/:id/uptime', (req, res) => {
  try {
    const deviceId = req.params.id;

    const getUptime = (period) => {
      const result = db.prepare(`
        SELECT 
          COUNT(CASE WHEN status = 'online' THEN 1 END) as online_count,
          COUNT(*) as total_count,
          AVG(CASE WHEN status = 'online' THEN response_time END) as avg_response
        FROM ping_logs
        WHERE device_id = ? AND checked_at > datetime('now', '-${period}')
      `).get(deviceId);

      return {
        uptime: result.total_count > 0
          ? parseFloat(((result.online_count / result.total_count) * 100).toFixed(2))
          : 0,
        totalChecks: result.total_count,
        onlineChecks: result.online_count,
        avgResponse: result.avg_response ? parseFloat(result.avg_response.toFixed(2)) : 0,
      };
    };

    res.json({
      last24h: getUptime('24 hours'),
      last7d: getUptime('7 days'),
      last30d: getUptime('30 days'),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get hourly aggregated data for chart
router.get('/api/devices/:id/chart', (req, res) => {
  try {
    const { hours = 24 } = req.query;
    const data = db.prepare(`
      SELECT 
        strftime('%Y-%m-%d %H:00', checked_at) as hour,
        AVG(response_time) as avg_response,
        COUNT(CASE WHEN status = 'online' THEN 1 END) as online_count,
        COUNT(*) as total_count
      FROM ping_logs
      WHERE device_id = ? AND checked_at > datetime('now', '-${parseInt(hours)} hours')
      GROUP BY strftime('%Y-%m-%d %H:00', checked_at)
      ORDER BY hour ASC
    `).all(req.params.id);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========================
// ALERTS
// ========================

router.get('/api/alerts', (req, res) => {
  try {
    const { limit = 50 } = req.query;
    const alerts = db.prepare(`
      SELECT a.*, d.name as device_name, d.ip_address
      FROM alerts a
      JOIN devices d ON a.device_id = d.id
      ORDER BY a.created_at DESC
      LIMIT ?
    `).all(parseInt(limit));
    res.json(alerts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/api/alerts/read-all', (req, res) => {
  try {
    db.prepare('UPDATE alerts SET is_read = 1 WHERE is_read = 0').run();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/api/alerts/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM alerts WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========================
// BACKUP MANAGEMENT
// ========================

const fs = require('fs');
const pathModule = require('path');

const BACKUP_DIR = pathModule.join(__dirname, '..', 'data', 'backups');
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

// Create a new backup
router.post('/api/backups', async (req, res) => {
  try {
    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const label = req.body.label || '';
    const safeName = label ? label.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40) : '';
    const filename = safeName
      ? `backup_${timestamp}_${safeName}.db`
      : `backup_${timestamp}.db`;
    const backupPath = pathModule.join(BACKUP_DIR, filename);

    // Use better-sqlite3 backup API for a safe, consistent backup
    await db.backup(backupPath);

    const stats = fs.statSync(backupPath);

    // Log the action
    logAction(req.user.id, 'Create Backup', `Label: ${label || 'None'}, File: ${filename}`, req.ip);

    res.status(201).json({
      success: true,
      backup: {
        filename,
        size: stats.size,
        label: label || null,
        created_at: now.toISOString(),
      },
    });
  } catch (error) {
    res.status(500).json({ error: 'Backup failed: ' + error.message });
  }
});

// List all backups
router.get('/api/backups', (req, res) => {
  try {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.endsWith('.db') && f.startsWith('backup_'))
      .map(f => {
        const stats = fs.statSync(pathModule.join(BACKUP_DIR, f));
        // Extract timestamp from filename: backup_YYYY-MM-DDTHH-MM-SS...
        const tsMatch = f.match(/backup_(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})/);
        let created = stats.mtime.toISOString();
        if (tsMatch) {
          created = tsMatch[1].replace(/T/, ' ').replace(/-/g, (m, offset) => offset > 9 ? ':' : '-') ;
          // Better: just use file mtime
          created = stats.birthtime.toISOString();
        }
        // Extract label
        const labelMatch = f.match(/backup_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}_(.+)\.db$/);
        return {
          filename: f,
          size: stats.size,
          label: labelMatch ? labelMatch[1].replace(/_/g, ' ') : null,
          created_at: stats.birthtime.toISOString(),
        };
      })
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    res.json(files);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Download a backup file
router.get('/api/backups/:filename/download', (req, res) => {
  try {
    const filename = req.params.filename;
    // Prevent path traversal
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }
    const filePath = pathModule.join(BACKUP_DIR, filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Backup not found' });
    }
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Restore from a backup (admin only)
router.post('/api/backups/:filename/restore', async (req, res) => {
  try {
    const filename = req.params.filename;
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }
    const filePath = pathModule.join(BACKUP_DIR, filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Backup not found' });
    }

    // First create a safety backup of current database
    const safetyName = `backup_pre-restore_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.db`;
    const safetyPath = pathModule.join(BACKUP_DIR, safetyName);
    await db.backup(safetyPath);

    // Restore: copy backup over current database using better-sqlite3
    const Database = require('better-sqlite3');
    const source = new Database(filePath, { readonly: true });
    await source.backup(db);
    source.close();

    // Log the action
    logAction(req.user.id, 'Restore Database', `Restored from: ${filename}`, req.ip);

    res.json({
      success: true,
      message: `Database restored from ${filename}. Safety backup created: ${safetyName}`,
      safetyBackup: safetyName,
    });
  } catch (error) {
    res.status(500).json({ error: 'Restore failed: ' + error.message });
  }
});

// Delete a backup
router.delete('/api/backups/:filename', (req, res) => {
  try {
    const filename = req.params.filename;
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }
    const filePath = pathModule.join(BACKUP_DIR, filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Backup not found' });
    }
    fs.unlinkSync(filePath);

    // Log the action
    logAction(req.user.id, 'Delete Backup', `Deleted: ${filename}`, req.ip);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get backup directory info
router.get('/api/backups/info', (req, res) => {
  try {
    const files = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.db'));
    let totalSize = 0;
    files.forEach(f => {
      totalSize += fs.statSync(pathModule.join(BACKUP_DIR, f)).size;
    });

    const dbPath = pathModule.join(__dirname, '..', 'data', 'monitor.db');
    const dbSize = fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0;

    res.json({
      backupCount: files.length,
      totalSize,
      databaseSize: dbSize,
      backupDir: BACKUP_DIR,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========================
// SETTINGS MANAGEMENT
// ========================

// Get all settings
router.get('/api/settings', (req, res) => {
  try {
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const settings = {};
    rows.forEach(r => { settings[r.key] = r.value; });
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update settings (admin only)
router.put('/api/settings', (req, res) => {
  try {
    const updates = req.body;
    const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    const tx = db.transaction(() => {
      for (const [key, value] of Object.entries(updates)) {
        upsert.run(key, String(value));
      }
    });
    tx();

    // Log the action
    logAction(req.user.id, 'Update Settings', `Keys: ${Object.keys(updates).join(', ')}`, req.ip);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========================
// LOGO UPLOAD
// ========================

const UPLOAD_DIR = pathModule.join(__dirname, '..', 'public', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

router.post('/api/settings/logo', (req, res) => {
  try {
    const contentType = req.headers['content-type'] || '';

    if (!contentType.includes('multipart/form-data')) {
      return res.status(400).json({ error: 'Multipart form data required' });
    }

    // Parse multipart manually (simple approach without multer)
    const boundary = contentType.split('boundary=')[1];
    if (!boundary) return res.status(400).json({ error: 'No boundary found' });

    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const bodyStr = body.toString('binary');

      // Find file content between boundaries
      const parts = bodyStr.split('--' + boundary);
      let fileData = null;
      let fileName = '';
      let fileMime = '';

      for (const part of parts) {
        if (part.includes('filename=')) {
          const nameMatch = part.match(/filename="([^"]+)"/);
          const mimeMatch = part.match(/Content-Type:\s*(.+)/i);
          if (nameMatch) fileName = nameMatch[1];
          if (mimeMatch) fileMime = mimeMatch[1].trim();

          // Validate image type
          if (!fileMime.startsWith('image/')) {
            return res.status(400).json({ error: 'Only image files allowed' });
          }

          // Extract file content (after \r\n\r\n)
          const headerEnd = part.indexOf('\r\n\r\n');
          if (headerEnd > -1) {
            const fileContent = part.substring(headerEnd + 4);
            // Remove trailing \r\n
            fileData = Buffer.from(fileContent.replace(/\r\n$/, ''), 'binary');
          }
        }
      }

      if (!fileData || !fileName) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      // Check file size (max 5MB)
      if (fileData.length > 5 * 1024 * 1024) {
        return res.status(400).json({ error: 'File size exceeds 5MB limit' });
      }

      // Save file with unique name
      const ext = pathModule.extname(fileName).toLowerCase() || '.png';
      const savedName = `logo_${Date.now()}${ext}`;
      const savePath = pathModule.join(UPLOAD_DIR, savedName);
      fs.writeFileSync(savePath, fileData);

      // Delete old logo if exists
      const oldLogo = db.prepare("SELECT value FROM settings WHERE key = 'logo_path'").get();
      if (oldLogo && oldLogo.value) {
        const oldPath = pathModule.join(__dirname, '..', 'public', oldLogo.value);
        if (fs.existsSync(oldPath)) {
          try { fs.unlinkSync(oldPath); } catch (e) {}
        }
      }

      // Update setting
      const logoUrl = `/uploads/${savedName}`;
      db.prepare("INSERT INTO settings (key, value) VALUES ('logo_path', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(logoUrl);

      // Log the action
      logAction(req.user.id, 'Upload Logo', `File: ${savedName}`, req.ip);

      res.json({ success: true, logo_path: logoUrl });
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete logo
router.delete('/api/settings/logo', (req, res) => {
  try {
    const current = db.prepare("SELECT value FROM settings WHERE key = 'logo_path'").get();
    if (current && current.value) {
      const filePath = pathModule.join(__dirname, '..', 'public', current.value);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
    db.prepare("INSERT INTO settings (key, value) VALUES ('logo_path', '') ON CONFLICT(key) DO UPDATE SET value = ''").run();

    // Log the action
    logAction(req.user.id, 'Delete Logo', 'Logo removed', req.ip);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========================
// AUDIT LOGS
// ========================

router.get('/api/audit-logs', (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  try {
    const logs = db.prepare(`
      SELECT l.*, u.username, u.full_name 
      FROM audit_logs l 
      LEFT JOIN users u ON l.user_id = u.id 
      ORDER BY l.created_at DESC 
      LIMIT 100
    `).all();
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
