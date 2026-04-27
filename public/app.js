// ===== Marine CCTV Dashboard - Frontend Application =====
const API_BASE = '';
let currentPage = 'dashboard';
let autoRefreshInterval = null;
let currentUser = null;

// ===== Navigation =====
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    navigateTo(item.dataset.page);
  });
});

function navigateTo(page) {
  currentPage = page;
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelector(`[data-page="${page}"]`).classList.add('active');
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(`page-${page}`).classList.add('active');
  // Close mobile sidebar
  document.getElementById('sidebar').classList.remove('open');
  // Load page data
  if (page === 'dashboard') loadDashboard();
  else if (page === 'devices') loadDevices();
  else if (page === 'uptime') loadUptimePage();
  else if (page === 'alerts') loadAlerts();
  else if (page === 'backup') loadBackups();
  else if (page === 'settings') loadSettings();
}

// Sidebar toggle
document.getElementById('sidebarToggle').addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('open');
});

// ===== API Helper =====
async function api(url, options = {}) {
  try {
    const res = await fetch(API_BASE + url, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    if (res.status === 401) {
      window.location.href = '/login';
      return;
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(err.error || 'Request failed');
    }
    return await res.json();
  } catch (err) {
    console.error('API Error:', err);
    throw err;
  }
}

// ===== Logout =====
async function logout() {
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
  } catch (e) {}
  window.location.href = '/login';
}

// ===== Toast Notifications =====
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; toast.style.transform = 'translateX(100%)'; setTimeout(() => toast.remove(), 300); }, 3500);
}

// ===== Dashboard =====
async function loadDashboard() {
  try {
    const [stats, devices, alerts] = await Promise.all([
      api('/api/dashboard/stats'),
      api('/api/devices'),
      api('/api/alerts?limit=5'),
    ]);
    renderKPIs(stats);
    renderDeviceGrid(devices);
    renderDashboardAlerts(alerts);
    updateAlertBadge(stats.unreadAlerts);
    updateLastChecked();
  } catch (err) {
    showToast('Failed to load dashboard: ' + err.message, 'error');
  }
}

function renderKPIs(stats) {
  animateValue('kpiTotal', stats.totalDevices);
  animateValue('kpiOnline', stats.onlineCount);
  animateValue('kpiOffline', stats.offlineCount);
  document.getElementById('kpiUptime').textContent = stats.uptimePercent + '%';
  document.getElementById('kpiLatency').textContent = stats.avgResponseTime + 'ms';
  animateValue('kpiAlerts', stats.unreadAlerts);
}

function animateValue(id, target) {
  const el = document.getElementById(id);
  const current = parseInt(el.textContent) || 0;
  if (current === target) { el.textContent = target; return; }
  const step = target > current ? 1 : -1;
  let val = current;
  const timer = setInterval(() => {
    val += step;
    el.textContent = val;
    if (val === target) clearInterval(timer);
  }, 50);
}

function renderDeviceGrid(devices) {
  const grid = document.getElementById('dashboardDeviceGrid');
  document.getElementById('deviceCountBadge').textContent = devices.length + ' devices';
  if (!devices.length) {
    grid.innerHTML = `<div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="64" height="64"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg><h4>No devices configured</h4><p>Add NVR devices to start monitoring</p><button class="btn btn-primary" onclick="navigateTo('devices')">Add Device</button></div>`;
    return;
  }
  grid.innerHTML = devices.map(d => {
    const status = d.last_status || 'unknown';
    const statusClass = status === 'online' ? 'status-online' : status === 'offline' ? 'status-offline' : 'status-unknown';
    const barClass = status === 'online' ? 'bar-online' : status === 'offline' ? 'bar-offline' : 'bar-unknown';
    const latency = d.last_response_time != null ? d.last_response_time + 'ms' : '--';
    const lastCheck = d.last_checked ? timeAgo(d.last_checked) : 'Never';
    return `<div class="device-card">
      <div class="device-card-bar ${barClass}"></div>
      <div class="device-card-header">
        <div><div class="device-card-name">${esc(d.name)}</div><div class="device-card-ip">${esc(d.ip_address)}</div></div>
        <span class="status-badge ${statusClass}">${status}</span>
      </div>
      <div class="device-card-meta">
        <div class="meta-item"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>${esc(d.location || 'N/A')}</div>
        <div class="meta-item"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>${latency}</div>
        <div class="meta-item"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>${d.channel_count || 0} CH</div>
      </div>
    </div>`;
  }).join('');
}

function renderDashboardAlerts(alerts) {
  const container = document.getElementById('dashboardAlerts');
  if (!alerts.length) { container.innerHTML = '<div class="empty-state-sm"><p>No recent alerts</p></div>'; return; }
  container.innerHTML = alerts.map(a => `<div class="alert-item ${a.is_read ? '' : 'unread'}">
    <div class="alert-dot alert-${a.alert_type}"></div>
    <div class="alert-content"><div class="alert-msg">${esc(a.message)}</div><div class="alert-time">${formatDate(a.created_at)}</div></div>
  </div>`).join('');
}

// ===== Devices Page =====
async function loadDevices() {
  try {
    const devices = await api('/api/devices');
    renderDeviceTable(devices);
    populateUptimeDeviceSelect(devices);
  } catch (err) { showToast('Failed to load devices', 'error'); }
}

function renderDeviceTable(devices) {
  const tbody = document.getElementById('deviceTableBody');
  if (!devices.length) { tbody.innerHTML = '<tr><td colspan="9" class="empty-cell">No devices configured yet</td></tr>'; return; }
  tbody.innerHTML = devices.map(d => {
    const status = d.last_status || 'unknown';
    const statusClass = status === 'online' ? 'status-online' : status === 'offline' ? 'status-offline' : 'status-unknown';
    const latency = d.last_response_time != null ? d.last_response_time : '--';
    const latencyClass = latency !== '--' ? (latency < 30 ? 'latency-good' : latency < 100 ? 'latency-mid' : 'latency-bad') : '';
    return `<tr>
      <td><span class="status-badge ${statusClass}">${status}</span></td>
      <td><strong>${esc(d.name)}</strong></td>
      <td><span class="ip-mono">${esc(d.ip_address)}</span></td>
      <td>${esc(d.location || '--')}</td>
      <td>${esc(d.device_type)}</td>
      <td>${d.channel_count || 0}</td>
      <td><span class="latency-value ${latencyClass}">${latency !== '--' ? latency + 'ms' : '--'}</span></td>
      <td>${d.last_checked ? timeAgo(d.last_checked) : 'Never'}</td>
      <td><div class="table-actions">
        <button class="btn btn-glass btn-sm" onclick="manualPing(${d.id})" title="Ping">⚡</button>
        <button class="btn btn-glass btn-sm" onclick="editDevice(${d.id})" title="Edit">✏️</button>
        <button class="btn btn-danger btn-sm" onclick="deleteDevice(${d.id})" title="Delete">🗑️</button>
      </div></td>
    </tr>`;
  }).join('');
}

// ===== Device CRUD =====
function openDeviceModal(device = null) {
  document.getElementById('modalTitle').textContent = device ? 'Edit Device' : 'Add NVR Device';
  document.getElementById('deviceId').value = device ? device.id : '';
  document.getElementById('deviceName').value = device ? device.name : '';
  document.getElementById('deviceIp').value = device ? device.ip_address : '';
  document.getElementById('deviceType').value = device ? device.device_type : 'NVR';
  document.getElementById('deviceLocation').value = device ? device.location : '';
  document.getElementById('deviceChannels').value = device ? device.channel_count : '';
  document.getElementById('deviceDesc').value = device ? device.description : '';
  document.getElementById('deviceModal').classList.add('open');
}
function closeDeviceModal() { document.getElementById('deviceModal').classList.remove('open'); }

async function saveDevice(e) {
  e.preventDefault();
  const id = document.getElementById('deviceId').value;
  const data = {
    name: document.getElementById('deviceName').value,
    ip_address: document.getElementById('deviceIp').value,
    device_type: document.getElementById('deviceType').value,
    location: document.getElementById('deviceLocation').value,
    channel_count: parseInt(document.getElementById('deviceChannels').value) || 0,
    description: document.getElementById('deviceDesc').value,
    is_active: 1,
  };
  try {
    if (id) { await api(`/api/devices/${id}`, { method: 'PUT', body: JSON.stringify(data) }); showToast('Device updated successfully', 'success'); }
    else { await api('/api/devices', { method: 'POST', body: JSON.stringify(data) }); showToast('Device added successfully', 'success'); }
    closeDeviceModal();
    loadDevices();
    loadDashboard();
  } catch (err) { showToast(err.message, 'error'); }
}

async function editDevice(id) {
  try {
    const devices = await api('/api/devices');
    const device = devices.find(d => d.id === id);
    if (device) openDeviceModal(device);
  } catch (err) { showToast('Failed to load device', 'error'); }
}

async function deleteDevice(id) {
  if (!confirm('Are you sure you want to delete this device?')) return;
  try {
    await api(`/api/devices/${id}`, { method: 'DELETE' });
    showToast('Device deleted', 'success');
    loadDevices();
    loadDashboard();
  } catch (err) { showToast('Failed to delete device', 'error'); }
}

async function manualPing(id) {
  showToast('Pinging device...', 'info');
  try {
    const result = await api(`/api/devices/${id}/ping`, { method: 'POST' });
    const msg = result.status === 'online' ? `Online - ${result.responseTime}ms` : 'Offline - No response';
    showToast(msg, result.status === 'online' ? 'success' : 'error');
    loadDevices();
    if (currentPage === 'dashboard') loadDashboard();
  } catch (err) { showToast('Ping failed: ' + err.message, 'error'); }
}

// ===== Refresh All =====
async function refreshAll() {
  const icon = document.getElementById('refreshIcon');
  icon.classList.add('spinning');
  showToast('Refreshing all devices...', 'info');
  try {
    await api('/api/devices/ping-all', { method: 'POST' });
    await loadDashboard();
    showToast('All devices refreshed', 'success');
  } catch (err) { showToast('Refresh failed', 'error'); }
  finally { icon.classList.remove('spinning'); }
}

// ===== Uptime Page =====
function populateUptimeDeviceSelect(devices) {
  const select = document.getElementById('uptimeDeviceSelect');
  const currentVal = select.value;
  select.innerHTML = '<option value="">Select Device</option>' + (devices || []).map(d => `<option value="${d.id}">${esc(d.name)} (${esc(d.ip_address)})</option>`).join('');
  if (currentVal) select.value = currentVal;
}

async function loadUptimePage() {
  try {
    const devices = await api('/api/devices');
    populateUptimeDeviceSelect(devices);
  } catch (err) {}
  loadUptimeData();
}

async function loadUptimeData() {
  const deviceId = document.getElementById('uptimeDeviceSelect').value;
  const hours = document.getElementById('uptimePeriodSelect').value;
  if (!deviceId) {
    document.getElementById('uptimeSummary').style.display = 'none';
    document.getElementById('chartContainer').style.display = 'none';
    document.getElementById('timelineContainer').style.display = 'none';
    document.getElementById('uptimeEmptyState').style.display = 'block';
    return;
  }
  document.getElementById('uptimeEmptyState').style.display = 'none';
  document.getElementById('uptimeSummary').style.display = 'grid';
  document.getElementById('chartContainer').style.display = 'block';
  document.getElementById('timelineContainer').style.display = 'block';

  try {
    const [uptime, chart, history] = await Promise.all([
      api(`/api/devices/${deviceId}/uptime`),
      api(`/api/devices/${deviceId}/chart?hours=${hours}`),
      api(`/api/devices/${deviceId}/history?hours=${hours}`),
    ]);
    renderUptimeRings(uptime);
    renderChart(chart);
    renderTimeline(history);
  } catch (err) { showToast('Failed to load uptime data', 'error'); }
}

function renderUptimeRings(data) {
  setRing('uptimeProgress24h', 'uptimeValue24h', data.last24h.uptime);
  setRing('uptimeProgress7d', 'uptimeValue7d', data.last7d.uptime);
  setRing('uptimeProgress30d', 'uptimeValue30d', data.last30d.uptime);
  document.getElementById('statTotalChecks').textContent = data.last24h.totalChecks;
  document.getElementById('statOnlineChecks').textContent = data.last24h.onlineChecks;
  document.getElementById('statAvgResponse').textContent = data.last24h.avgResponse + 'ms';
}

function setRing(circleId, valueId, percent) {
  const circumference = 326.73;
  const offset = circumference - (percent / 100) * circumference;
  document.getElementById(circleId).style.strokeDashoffset = offset;
  document.getElementById(valueId).textContent = percent + '%';
}

// ===== Chart (Canvas) =====
function renderChart(data) {
  const canvas = document.getElementById('responseChart');
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = 300 * dpr;
  canvas.style.height = '300px';
  ctx.scale(dpr, dpr);
  const W = rect.width, H = 300;
  ctx.clearRect(0, 0, W, H);

  if (!data.length) { ctx.fillStyle = '#64748b'; ctx.font = '14px Inter'; ctx.textAlign = 'center'; ctx.fillText('No data available', W / 2, H / 2); return; }

  const values = data.map(d => d.avg_response || 0);
  const maxVal = Math.max(...values, 1) * 1.2;
  const padL = 50, padR = 20, padT = 20, padB = 40;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;

  // Grid lines
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = padT + (chartH / 4) * i;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
    ctx.fillStyle = '#64748b'; ctx.font = '11px JetBrains Mono'; ctx.textAlign = 'right';
    ctx.fillText(Math.round(maxVal - (maxVal / 4) * i) + 'ms', padL - 8, y + 4);
  }

  // Data points
  const points = values.map((v, i) => ({
    x: padL + (chartW / (values.length - 1 || 1)) * i,
    y: padT + chartH - (v / maxVal) * chartH,
  }));

  // Gradient fill
  const gradient = ctx.createLinearGradient(0, padT, 0, H - padB);
  gradient.addColorStop(0, 'rgba(0,212,255,0.25)');
  gradient.addColorStop(1, 'rgba(0,212,255,0)');
  ctx.beginPath();
  ctx.moveTo(points[0].x, H - padB);
  points.forEach(p => ctx.lineTo(p.x, p.y));
  ctx.lineTo(points[points.length - 1].x, H - padB);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  // Line
  ctx.beginPath();
  ctx.strokeStyle = '#00d4ff';
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  points.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
  ctx.stroke();

  // Dots
  points.forEach(p => {
    ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#00d4ff'; ctx.fill();
  });

  // X labels
  ctx.fillStyle = '#64748b'; ctx.font = '10px JetBrains Mono'; ctx.textAlign = 'center';
  const step = Math.max(1, Math.floor(data.length / 8));
  data.forEach((d, i) => {
    if (i % step === 0) {
      const hour = d.hour.split(' ')[1] || d.hour;
      ctx.fillText(hour, points[i].x, H - padB + 18);
    }
  });
}

function renderTimeline(history) {
  const container = document.getElementById('uptimeTimeline');
  if (!history.length) { container.innerHTML = '<div style="text-align:center;color:#64748b;padding:10px;">No data</div>'; return; }
  const reversed = [...history].reverse();
  const maxBlocks = Math.min(reversed.length, 200);
  const step = Math.max(1, Math.floor(reversed.length / maxBlocks));
  let html = '';
  for (let i = 0; i < reversed.length; i += step) {
    const h = reversed[i];
    const cls = h.status === 'online' ? 't-online' : h.status === 'offline' ? 't-offline' : 't-unknown';
    html += `<div class="timeline-block ${cls}" title="${h.checked_at} - ${h.status}${h.response_time ? ' (' + h.response_time + 'ms)' : ''}"></div>`;
  }
  container.innerHTML = html;
}

// ===== Alerts Page =====
async function loadAlerts() {
  try {
    const alerts = await api('/api/alerts?limit=100');
    renderFullAlerts(alerts);
  } catch (err) { showToast('Failed to load alerts', 'error'); }
}

function renderFullAlerts(alerts) {
  const container = document.getElementById('alertsFullList');
  if (!alerts.length) {
    container.innerHTML = '<div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="64" height="64"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg><h4>No alerts</h4><p>All systems are running smoothly</p></div>';
    return;
  }
  container.innerHTML = alerts.map(a => `<div class="alert-item ${a.is_read ? '' : 'unread'}">
    <div class="alert-dot alert-${a.alert_type}"></div>
    <div class="alert-content">
      <div class="alert-msg">${esc(a.message)}</div>
      <div class="alert-time">${formatDate(a.created_at)} • ${esc(a.device_name)}</div>
    </div>
    <button class="alert-delete" onclick="deleteAlert(${a.id})" title="Delete"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
  </div>`).join('');
}

async function markAllAlertsRead() {
  try { await api('/api/alerts/read-all', { method: 'PUT' }); showToast('All alerts marked as read', 'success'); loadAlerts(); updateAlertBadge(0); } catch (err) { showToast('Failed', 'error'); }
}

async function deleteAlert(id) {
  try { await api(`/api/alerts/${id}`, { method: 'DELETE' }); loadAlerts(); } catch (err) { showToast('Failed', 'error'); }
}

function updateAlertBadge(count) {
  const badge = document.getElementById('alertBadge');
  if (count > 0) { badge.style.display = 'inline'; badge.textContent = count; } else { badge.style.display = 'none'; }
}

// ===== Backup Page =====
async function loadBackups() {
  try {
    const [backups, info] = await Promise.all([
      api('/api/backups'),
      api('/api/backups/info'),
    ]);
    renderBackupInfo(info);
    renderBackupList(backups);
  } catch (err) {
    showToast('Failed to load backups: ' + err.message, 'error');
  }
}

function renderBackupInfo(info) {
  document.getElementById('backupDbSize').textContent = formatFileSize(info.databaseSize);
  document.getElementById('backupCount').textContent = info.backupCount;
  document.getElementById('backupTotalSize').textContent = formatFileSize(info.totalSize);
}

function renderBackupList(backups) {
  const container = document.getElementById('backupList');
  if (!backups.length) {
    container.innerHTML = `<div class="empty-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="64" height="64"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      <h4>Belum ada backup</h4>
      <p>Klik "Create Backup" untuk membuat backup pertama</p>
    </div>`;
    return;
  }
  container.innerHTML = backups.map(b => {
    const isRestore = b.filename.includes('pre-restore');
    const tagHtml = b.label ? `<span class="backup-tag">${esc(b.label)}</span>` : '';
    const restoreTag = isRestore ? '<span class="backup-tag backup-tag-safety">safety</span>' : '';
    return `<div class="backup-item">
      <div class="backup-item-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>
      </div>
      <div class="backup-item-info">
        <div class="backup-item-name">${esc(b.filename)} ${tagHtml} ${restoreTag}</div>
        <div class="backup-item-meta">
          <span>${formatFileSize(b.size)}</span>
          <span>•</span>
          <span>${formatDate(b.created_at)}</span>
        </div>
      </div>
      <div class="backup-item-actions">
        <button class="btn btn-glass btn-sm" onclick="downloadBackup('${esc(b.filename)}')" title="Download">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        </button>
        <button class="btn btn-glass btn-sm" onclick="restoreBackup('${esc(b.filename)}')" title="Restore">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
        </button>
        <button class="btn btn-danger btn-sm" onclick="deleteBackup('${esc(b.filename)}')" title="Delete">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      </div>
    </div>`;
  }).join('');
}

async function createBackup() {
  const label = prompt('Label backup (opsional, kosongkan jika tidak perlu):');
  if (label === null) return; // cancelled
  showToast('Creating backup...', 'info');
  try {
    const result = await api('/api/backups', {
      method: 'POST',
      body: JSON.stringify({ label: label.trim() }),
    });
    showToast(`Backup berhasil: ${result.backup.filename}`, 'success');
    loadBackups();
  } catch (err) {
    showToast('Backup gagal: ' + err.message, 'error');
  }
}

function downloadBackup(filename) {
  window.open(`/api/backups/${encodeURIComponent(filename)}/download`, '_blank');
}

async function restoreBackup(filename) {
  if (!confirm(`⚠️ PERHATIAN: Restore akan mengganti seluruh data saat ini dengan data dari backup:\n\n${filename}\n\nBackup keamanan akan dibuat otomatis sebelum restore.\n\nLanjutkan?`)) return;
  if (!confirm('Apakah Anda benar-benar yakin? Tindakan ini tidak dapat dibatalkan.')) return;
  showToast('Restoring database...', 'info');
  try {
    const result = await api(`/api/backups/${encodeURIComponent(filename)}/restore`, { method: 'POST' });
    showToast(result.message, 'success');
    loadBackups();
    // Reload dashboard data since database changed
    loadDashboard();
  } catch (err) {
    showToast('Restore gagal: ' + err.message, 'error');
  }
}

async function deleteBackup(filename) {
  if (!confirm(`Hapus backup "${filename}"?`)) return;
  try {
    await api(`/api/backups/${encodeURIComponent(filename)}`, { method: 'DELETE' });
    showToast('Backup dihapus', 'success');
    loadBackups();
  } catch (err) {
    showToast('Gagal menghapus backup: ' + err.message, 'error');
  }
}

function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return parseFloat((bytes / Math.pow(1024, i)).toFixed(1)) + ' ' + units[i];
}
// ===== Settings Page =====
function switchSettingsTab(tab) {
  document.querySelectorAll('.stab').forEach(t => t.classList.remove('active'));
  document.querySelector(`[data-stab="${tab}"]`).classList.add('active');
  document.querySelectorAll('.stab-content').forEach(c => c.classList.remove('active'));
  document.getElementById(`stab-content-${tab}`).classList.add('active');
}

async function loadSettings() {
  loadUsers();
  loadLandingSettings();
  loadLogoPreview();
  loadAuditLogs();
  checkUpdate();
}

// --- System Update ---
async function checkUpdate() {
  const area = document.getElementById('updateStatusArea');
  if (!area) return;

  // Reset UI
  document.getElementById('updateChecking').style.display = 'block';
  document.getElementById('updateInfo').style.display = 'none';
  document.getElementById('updateNone').style.display = 'none';
  document.getElementById('updateProgress').style.display = 'none';
  document.getElementById('updateOutput').style.display = 'none';

  try {
    const res = await api('/api/system/check-update');
    document.getElementById('currentVersionTag').textContent = 'v' + res.currentVersion;
    document.getElementById('updateChecking').style.display = 'none';

    if (res.updateAvailable) {
      document.getElementById('updateInfo').style.display = 'block';
      document.getElementById('remoteVersion').textContent = res.latestVersion;
    } else {
      document.getElementById('updateNone').style.display = 'block';
    }
  } catch (err) {
    document.getElementById('updateChecking').innerHTML = `
      <p style="color: var(--red); margin-bottom: 10px;">Gagal mengecek update</p>
      <p style="font-size: 0.8rem; color: var(--text-muted);">${err.message}</p>
      <button class="btn btn-glass btn-sm" style="margin-top: 15px;" onclick="checkUpdate()">Coba Lagi</button>
    `;
  }
}

async function runUpdate() {
  if (!confirm('Aplikasi akan diperbarui menggunakan Git Pull. Lanjutkan?')) return;

  document.getElementById('updateInfo').style.display = 'none';
  document.getElementById('updateProgress').style.display = 'block';
  document.getElementById('updateOutput').style.display = 'none';

  try {
    const res = await api('/api/system/update', { method: 'POST' });
    
    document.getElementById('updateProgress').style.display = 'none';
    document.getElementById('updateOutput').style.display = 'block';
    document.getElementById('updateOutputText').textContent = res.output || 'Update selesai tanpa output.';
    
    showToast('Update berhasil! Me-refresh halaman...', 'success');
    setTimeout(() => window.location.reload(), 3000);
  } catch (err) {
    document.getElementById('updateProgress').style.display = 'none';
    document.getElementById('updateOutput').style.display = 'block';
    document.getElementById('updateOutputText').textContent = 'ERROR: ' + err.message + (err.details ? '\n\n' + err.details : '');
    document.getElementById('updateOutputText').style.color = 'var(--red)';
    showToast('Update gagal: ' + err.message, 'error');
  }
}

// --- Audit Logs ---
async function loadAuditLogs() {
  try {
    const logs = await api('/api/audit-logs');
    renderAuditLogsTable(logs);
  } catch (err) {
    console.error('Failed to load logs:', err);
  }
}

function renderAuditLogsTable(logs) {
  const tbody = document.getElementById('logsTableBody');
  if (!logs || !logs.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-cell">Belum ada history log</td></tr>';
    return;
  }
  tbody.innerHTML = logs.map(l => `
    <tr>
      <td style="white-space:nowrap;color:var(--text-muted);font-size:0.8rem;">${formatDate(l.created_at)}</td>
      <td><strong>${esc(l.username || 'System')}</strong></td>
      <td><span class="backup-tag">${l.action}</span></td>
      <td style="font-size:0.85rem;">${esc(l.details || '-')}</td>
      <td style="color:var(--text-muted);font-size:0.8rem;">${l.ip_address || '-'}</td>
    </tr>
  `).join('');
}

// --- User Management ---
async function loadUsers() {
  try {
    const users = await api('/api/users');
    renderUserTable(users);
  } catch (err) {
    showToast('Failed to load users', 'error');
  }
}

function renderUserTable(users) {
  const tbody = document.getElementById('userTableBody');
  if (!users.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">Belum ada user</td></tr>';
    return;
  }
  tbody.innerHTML = users.map(u => {
    const statusClass = u.is_active ? 'status-online' : 'status-offline';
    const statusText = u.is_active ? 'active' : 'inactive';
    const roleClass = u.role === 'admin' ? 'backup-tag' : u.role === 'operator' ? 'backup-tag backup-tag-safety' : 'backup-tag';
    const isSelf = currentUser && currentUser.id === u.id;
    return `<tr>
      <td><span class="status-badge ${statusClass}">${statusText}</span></td>
      <td><strong>${esc(u.username)}</strong>${isSelf ? ' <span style="color:var(--accent-cyan);font-size:0.7rem;">(you)</span>' : ''}</td>
      <td>${esc(u.full_name || '--')}</td>
      <td><span class="${roleClass}">${u.role}</span></td>
      <td>${formatDate(u.created_at)}</td>
      <td>${u.last_login ? formatDate(u.last_login) : 'Never'}</td>
      <td><div class="table-actions">
        <button class="btn btn-glass btn-sm" onclick='editUser(${JSON.stringify(u).replace(/'/g, "&#39;")})' title="Edit">✏️</button>
        ${!isSelf ? `<button class="btn btn-danger btn-sm" onclick="deleteUser(${u.id})" title="Delete">🗑️</button>` : ''}
      </div></td>
    </tr>`;
  }).join('');
}

function openUserModal(user = null) {
  document.getElementById('userModalTitle').textContent = user ? 'Edit User' : 'Tambah User';
  document.getElementById('editUserId').value = user ? user.id : '';
  document.getElementById('editUsername').value = user ? user.username : '';
  document.getElementById('editUsername').disabled = !!user;
  document.getElementById('editFullName').value = user ? (user.full_name || '') : '';
  document.getElementById('editUserRole').value = user ? user.role : 'operator';
  document.getElementById('editUserPassword').value = '';
  document.getElementById('editUserPassword').required = !user;
  document.getElementById('pwdHint').textContent = user ? '(kosongkan jika tidak diubah)' : '*';
  document.getElementById('userModal').classList.add('open');
}
function closeUserModal() { document.getElementById('userModal').classList.remove('open'); }

function editUser(user) { openUserModal(user); }

async function saveUser(e) {
  e.preventDefault();
  const id = document.getElementById('editUserId').value;
  const data = {
    full_name: document.getElementById('editFullName').value,
    role: document.getElementById('editUserRole').value,
  };
  const password = document.getElementById('editUserPassword').value;
  if (password) data.password = password;

  try {
    if (id) {
      await api(`/api/users/${id}`, { method: 'PUT', body: JSON.stringify(data) });
      showToast('User berhasil diupdate', 'success');
    } else {
      data.username = document.getElementById('editUsername').value;
      if (!password) { showToast('Password wajib diisi', 'error'); return; }
      await api('/api/users', { method: 'POST', body: JSON.stringify(data) });
      showToast('User berhasil ditambahkan', 'success');
    }
    closeUserModal();
    loadUsers();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deleteUser(id) {
  if (!confirm('Hapus user ini?')) return;
  try {
    await api(`/api/users/${id}`, { method: 'DELETE' });
    showToast('User dihapus', 'success');
    loadUsers();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// --- Landing Page Settings ---
async function loadLandingSettings() {
  try {
    const s = await api('/api/settings');
    document.getElementById('setAppName').value = s.app_name || '';
    document.getElementById('setHeroBadge').value = s.hero_badge || '';
    document.getElementById('setHeroTitle1').value = s.hero_title_1 || '';
    document.getElementById('setHeroTitle2').value = s.hero_title_2 || '';
    document.getElementById('setHeroDesc').value = s.hero_description || '';
    document.getElementById('setCtaTitle').value = s.cta_title || '';
    document.getElementById('setCtaDesc').value = s.cta_description || '';
    document.getElementById('setFooter').value = s.footer_text || '';
  } catch (err) {}
}

async function saveLandingSettings(e) {
  e.preventDefault();
  try {
    await api('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({
        app_name: document.getElementById('setAppName').value,
        hero_badge: document.getElementById('setHeroBadge').value,
        hero_title_1: document.getElementById('setHeroTitle1').value,
        hero_title_2: document.getElementById('setHeroTitle2').value,
        hero_description: document.getElementById('setHeroDesc').value,
        cta_title: document.getElementById('setCtaTitle').value,
        cta_description: document.getElementById('setCtaDesc').value,
        footer_text: document.getElementById('setFooter').value,
      }),
    });
    showToast('Landing page settings saved!', 'success');
  } catch (err) {
    showToast('Failed to save settings', 'error');
  }
}

// --- Logo Management ---
async function loadLogoPreview() {
  try {
    const s = await api('/api/settings');
    const img = document.getElementById('logoPreviewImg');
    const placeholder = document.getElementById('logoPlaceholder');
    if (s.logo_path) {
      img.src = s.logo_path + '?t=' + Date.now();
      img.style.display = 'block';
      placeholder.style.display = 'none';
    } else {
      img.style.display = 'none';
      placeholder.style.display = 'flex';
    }
  } catch (err) {}
}

async function uploadLogo(input) {
  const file = input.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    showToast('Hanya file gambar yang diizinkan', 'error');
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    showToast('Ukuran file maks 5MB', 'error');
    return;
  }

  const formData = new FormData();
  formData.append('logo', file);

  try {
    const res = await fetch('/api/settings/logo', {
      method: 'POST',
      body: formData,
    });
    if (res.status === 401) { window.location.href = '/login'; return; }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    showToast('Logo berhasil diupload!', 'success');
    loadLogoPreview();
  } catch (err) {
    showToast('Upload gagal: ' + err.message, 'error');
  }
  input.value = '';
}

async function deleteLogo() {
  if (!confirm('Hapus logo saat ini?')) return;
  try {
    await api('/api/settings/logo', { method: 'DELETE' });
    showToast('Logo dihapus', 'success');
    loadLogoPreview();
  } catch (err) {
    showToast('Gagal menghapus logo', 'error');
  }
}

// ===== Utilities =====
function esc(str) { const d = document.createElement('div'); d.textContent = str || ''; return d.innerHTML; }
function formatDate(d) { if (!d) return '--'; try { const dt = d.includes('Z') || d.includes('+') ? d : d + 'Z'; return new Date(dt).toLocaleString('id-ID'); } catch { return d; } }
function timeAgo(d) {
  if (!d) return 'Never';
  const now = Date.now(), then = new Date(d + 'Z').getTime(), diff = Math.floor((now - then) / 1000);
  if (diff < 60) return diff + 's ago';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  return Math.floor(diff / 86400) + 'd ago';
}
function updateLastChecked() { document.getElementById('lastUpdate').textContent = 'Last update: ' + new Date().toLocaleTimeString('id-ID'); }

// ===== Auto Refresh =====
function startAutoRefresh() {
  autoRefreshInterval = setInterval(() => {
    if (currentPage === 'dashboard') loadDashboard();
  }, 30000);
}

// ===== Init =====
(async function init() {
  try {
    const data = await fetch('/api/auth/me').then(r => { if (!r.ok) throw new Error(); return r.json(); });
    currentUser = data.user;

    // Load settings for branding
    const settings = await api('/api/settings').catch(() => ({}));

    // Update branding in sidebar
    if (settings.app_name) {
      document.querySelectorAll('.logo-text').forEach(el => el.textContent = settings.app_name);
    }
    if (settings.logo_path) {
      document.querySelectorAll('.logo svg').forEach(svg => {
        const img = document.createElement('img');
        img.src = settings.logo_path;
        img.alt = settings.app_name || 'Logo';
        img.style.cssText = 'width:32px;height:32px;object-fit:contain;border-radius:6px;';
        svg.parentNode.replaceChild(img, svg);
      });
    }

    // Role-based sidebar visibility
    if (currentUser.role !== 'admin') {
      const navBackup = document.getElementById('nav-backup');
      const navSettings = document.getElementById('nav-settings');
      if (navBackup) navBackup.style.display = 'none';
      if (navSettings) navSettings.style.display = 'none';
      // Hide divider if backup is hidden
      const divider = document.querySelector('.nav-divider');
      if (divider) divider.style.display = 'none';
    }

    // Update user display in sidebar
    const userInfoEl = document.getElementById('userInfo');
    if (userInfoEl) {
      userInfoEl.querySelector('.user-name').textContent = currentUser.full_name || currentUser.username;
      userInfoEl.querySelector('.user-role').textContent = currentUser.role;
      userInfoEl.style.display = 'flex';
    }
    loadDashboard();
    startAutoRefresh();
  } catch (e) {
    window.location.href = '/login';
  }
})();
