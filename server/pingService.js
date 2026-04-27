const ping = require('ping');
const db = require('./database');

// Track previous states for alert generation
const previousStates = new Map();

/**
 * Ping a single device and log the result
 */
async function pingDevice(device) {
  try {
    const result = await ping.promise.probe(device.ip_address, {
      timeout: 5,
      extra: ['-n', '1'], // Windows: -n, Linux: -c
    });

    const status = result.alive ? 'online' : 'offline';
    const responseTime = result.alive ? parseFloat(result.time) : null;

    // Log ping result
    const insertLog = db.prepare(`
      INSERT INTO ping_logs (device_id, status, response_time)
      VALUES (?, ?, ?)
    `);
    insertLog.run(device.id, status, responseTime);

    // Check for state change and create alerts
    const prevState = previousStates.get(device.id);
    if (prevState && prevState !== status) {
      const insertAlert = db.prepare(`
        INSERT INTO alerts (device_id, alert_type, message)
        VALUES (?, ?, ?)
      `);

      if (status === 'offline') {
        insertAlert.run(device.id, 'down',
          `${device.name} (${device.ip_address}) is DOWN - No response received`
        );
      } else if (status === 'online' && prevState === 'offline') {
        insertAlert.run(device.id, 'recovered',
          `${device.name} (${device.ip_address}) has RECOVERED - Response time: ${responseTime}ms`
        );
      }
    }

    // Check for high latency
    if (status === 'online' && responseTime > 100) {
      const existingHighLatency = db.prepare(`
        SELECT id FROM alerts 
        WHERE device_id = ? AND alert_type = 'high_latency' 
        AND created_at > datetime('now', '-5 minutes')
      `).get(device.id);

      if (!existingHighLatency) {
        const insertAlert = db.prepare(`
          INSERT INTO alerts (device_id, alert_type, message)
          VALUES (?, ?, ?)
        `);
        insertAlert.run(device.id, 'high_latency',
          `${device.name} (${device.ip_address}) HIGH LATENCY - Response time: ${responseTime}ms`
        );
      }
    }

    previousStates.set(device.id, status);

    return { deviceId: device.id, status, responseTime };
  } catch (error) {
    console.error(`Error pinging ${device.name} (${device.ip_address}):`, error.message);

    const insertLog = db.prepare(`
      INSERT INTO ping_logs (device_id, status, response_time)
      VALUES (?, ?, ?)
    `);
    insertLog.run(device.id, 'timeout', null);

    previousStates.set(device.id, 'offline');

    return { deviceId: device.id, status: 'timeout', responseTime: null };
  }
}

/**
 * Ping all active devices
 */
async function pingAllDevices() {
  const devices = db.prepare('SELECT * FROM devices WHERE is_active = 1').all();
  const results = await Promise.all(devices.map(d => pingDevice(d)));
  return results;
}

/**
 * Start the periodic ping monitoring
 */
let pingInterval = null;

function startMonitoring(intervalMs = 30000) {
  if (pingInterval) {
    clearInterval(pingInterval);
  }

  console.log(`[PingService] Starting monitoring with ${intervalMs / 1000}s interval`);

  // Initial ping
  pingAllDevices().then(results => {
    console.log(`[PingService] Initial ping complete: ${results.length} devices checked`);
  });

  pingInterval = setInterval(() => {
    pingAllDevices().then(results => {
      const online = results.filter(r => r.status === 'online').length;
      const offline = results.filter(r => r.status !== 'online').length;
      console.log(`[PingService] Ping cycle: ${online} online, ${offline} offline`);
    });
  }, intervalMs);
}

function stopMonitoring() {
  if (pingInterval) {
    clearInterval(pingInterval);
    pingInterval = null;
    console.log('[PingService] Monitoring stopped');
  }
}

/**
 * Clean old ping logs (keep last 7 days)
 */
function cleanOldLogs() {
  const result = db.prepare(`
    DELETE FROM ping_logs WHERE checked_at < datetime('now', '-7 days')
  `).run();
  console.log(`[PingService] Cleaned ${result.changes} old ping logs`);
}

module.exports = {
  pingDevice,
  pingAllDevices,
  startMonitoring,
  stopMonitoring,
  cleanOldLogs,
};
