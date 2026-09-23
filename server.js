const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const QRCode = require('qrcode');

const app = express();
const PORT = 3002;

const QRS_FILE = path.join(__dirname, 'data', 'qrs.json');
const SCANS_FILE = path.join(__dirname, 'data', 'scans.json');

app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

function readJSON(file, fallback = []) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) { return fallback; }
}
function writeJSON(file, data) {
  try { fs.writeFileSync(file, JSON.stringify(data, null, 2)); } catch (e) {}
}

// API: List QR codes
app.get('/api/qrs', (req, res) => {
  res.json(readJSON(QRS_FILE));
});

// API: Create QR code
app.post('/api/qrs', (req, res) => {
  const qrs = readJSON(QRS_FILE);
  const data = {
    _id: 'qr_' + uuidv4().slice(0, 8),
    name: (req.body.name || 'QR Code').trim().slice(0, 100),
    content: req.body.content || '',
    type: req.body.type || 'url',
    style: req.body.style || { fg: '#1e293b', bg: '#ffffff', logo: null, size: 300 },
    createdAt: new Date().toISOString(),
    scans: 0
  };
  qrs.push(data);
  writeJSON(QRS_FILE, qrs);
  res.json(data);
});

// API: Update QR code
app.put('/api/qrs/:id', (req, res) => {
  const qrs = readJSON(QRS_FILE);
  const idx = qrs.findIndex(q => q._id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  qrs[idx].name = (req.body.name || qrs[idx].name).trim().slice(0, 100);
  if (req.body.content) qrs[idx].content = req.body.content;
  if (req.body.style) qrs[idx].style = req.body.style;
  writeJSON(QRS_FILE, qrs);
  res.json(qrs[idx]);
});

// API: Delete QR code
app.delete('/api/qrs/:id', (req, res) => {
  let qrs = readJSON(QRS_FILE);
  qrs = qrs.filter(q => q._id !== req.params.id);
  writeJSON(QRS_FILE, qrs);
  res.json({ ok: true });
});

// API: Generate QR code image (PNG/SVG)
app.post('/api/qrs/:id/generate', async (req, res) => {
  const qrs = readJSON(QRS_FILE);
  const qr = qrs.find(q => q._id === req.params.id);
  if (!qr) return res.status(404).json({ error: 'Not found' });

  const format = req.body.format || 'png';
  const style = qr.style || {};
  const size = style.size || 300;
  const fg = style.fg || '#1e293b';
  const bg = style.bg || '#ffffff';

  try {
    if (format === 'svg') {
      const svg = await QRCode.toString(qr.content, {
        type: 'svg',
        width: size,
        color: { dark: fg, light: bg },
        margin: 2
      });
      res.set('Content-Type', 'image/svg+xml');
      res.send(svg);
    } else {
      const buffer = await QRCode.toBuffer(qr.content, {
        width: size,
        color: { dark: fg, light: bg },
        margin: 2
      });
      res.set('Content-Type', 'image/png');
      res.send(buffer);
    }
  } catch (e) {
    res.status(500).json({ error: 'Generation failed' });
  }
});

// GET handler for generate (for direct browser access)
app.get('/api/qrs/:id/generate', async (req, res) => {
  const qrs = readJSON(QRS_FILE);
  const qr = qrs.find(q => q._id === req.params.id);
  if (!qr) return res.status(404).json({ error: 'Not found' });

  const format = req.query.format || 'png';
  const style = qr.style || {};
  const size = style.size || 300;
  const fg = style.fg || '#1e293b';
  const bg = style.bg || '#ffffff';

  try {
    if (format === 'svg') {
      const svg = await QRCode.toString(qr.content, {
        type: 'svg',
        width: size,
        color: { dark: fg, light: bg },
        margin: 2
      });
      res.set('Content-Type', 'image/svg+xml');
      res.send(svg);
    } else {
      const buffer = await QRCode.toBuffer(qr.content, {
        width: size,
        color: { dark: fg, light: bg },
        margin: 2
      });
      res.set('Content-Type', 'image/png');
      res.send(buffer);
    }
  } catch (e) {
    res.status(500).json({ error: 'Generation failed' });
  }
});

// API: Track scan (public endpoint for QR redirect)
app.get('/scan/:id', (req, res) => {
  const qrs = readJSON(QRS_FILE);
  const qr = qrs.find(q => q._id === req.params.id);
  if (!qr) return res.status(404).send('QR code not found');

  // Log scan
  const scans = readJSON(SCANS_FILE);
  const ua = req.headers['user-agent'] || '';
  const ip = req.ip || req.connection.remoteAddress;
  const scan = {
    _id: 'scan_' + uuidv4().slice(0, 8),
    qrId: qr._id,
    timestamp: new Date().toISOString(),
    userAgent: ua,
    ip: ip,
    device: ua.includes('Mobile') ? 'mobile' : ua.includes('Tablet') ? 'tablet' : 'desktop',
    browser: ua.includes('Chrome') ? 'Chrome' : ua.includes('Firefox') ? 'Firefox' : ua.includes('Safari') ? 'Safari' : 'Other',
    os: ua.includes('Windows') ? 'Windows' : ua.includes('Mac') ? 'macOS' : ua.includes('Linux') ? 'Linux' : ua.includes('Android') ? 'Android' : ua.includes('iOS') ? 'iOS' : 'Other'
  };
  scans.push(scan);
  writeJSON(SCANS_FILE, scans);

  // Increment scan count
  qr.scans = (qr.scans || 0) + 1;
  writeJSON(QRS_FILE, qrs);

  // Redirect to actual content
  res.redirect(qr.content);
});

// API: Get analytics for a QR
app.get('/api/qrs/:id/analytics', (req, res) => {
  const scans = readJSON(SCANS_FILE);
  const qrScans = scans.filter(s => s.qrId === req.params.id);

  const total = qrScans.length;
  const today = new Date().toISOString().split('T')[0];
  const todayScans = qrScans.filter(s => s.timestamp.startsWith(today)).length;

  const byDevice = qrScans.reduce((acc, s) => {
    acc[s.device] = (acc[s.device] || 0) + 1;
    return acc;
  }, {});
  const byBrowser = qrScans.reduce((acc, s) => {
    acc[s.browser] = (acc[s.browser] || 0) + 1;
    return acc;
  }, {});
  const byOS = qrScans.reduce((acc, s) => {
    acc[s.os] = (acc[s.os] || 0) + 1;
    return acc;
  }, {});

  // Last 7 days
  const last7 = {};
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().split('T')[0];
    last7[key] = qrScans.filter(s => s.timestamp.startsWith(key)).length;
  }

  res.json({ total, today: todayScans, byDevice, byBrowser, byOS, last7 });
});

module.exports = app;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n  QRCode Analytics v1.0`);
    console.log(`  Server: http://localhost:${PORT}`);
    console.log(`  Dashboard: http://localhost:${PORT}\n`);
  });
}