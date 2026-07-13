// Express Server: Odoo Executive Dashboard + API
const path = require('path');
const express = require('express');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '.env.local') });

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Dashboard UI (served at / — behind Apache this appears as /Odoo/)
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});
app.get('/config', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'config.html'));
});
// API guideline สำหรับทีมภายนอก (behind Apache = /Odoo/APIGuide)
app.get('/APIGuide', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'api-guide.html'));
});

// Odoo API routes
const odooApi = require('./odoo-api');
app.use('/api/odoo', odooApi);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Odoo dashboard server is running' });
});

// API documentation
app.get('/api', (req, res) => {
  res.json({
    name: 'Odoo Dashboard API',
    version: '2.0.0',
    endpoints: {
      'GET /': 'Executive dashboard UI',
      'GET /APIGuide': 'API guideline สำหรับทีมภายนอก (หน้าเว็บ + ลิงก์ PDF/OpenAPI/Postman)',
      'GET /api/odoo/dashboard?teamId=all|N': 'Dashboard data (real-time, 60s cache)',
      'GET /api/odoo/business-units': 'Sales teams with volume this year',
      'GET /api/odoo/tables': 'List database tables',
      'GET /api/odoo/schema/:tableName': 'Table schema',
      'POST /api/odoo/query': 'Read-only SELECT query {sql: "..."}',
      'GET /config': 'หน้าตั้งค่าตารางที่เปิด INSERT (ต้องมี admin token)',
      'POST /api/odoo/insert/:table': 'Insert ข้อมูล (Bearer token + ตารางต้องเปิดใน /config)',
      'GET|PUT /api/odoo/config/writable-tables': 'ดู/ตั้งรายชื่อตารางที่เปิด INSERT (Bearer token)',
      'GET /health': 'Health check',
    },
  });
});

// Error handling
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`✓ Odoo dashboard server running on port ${PORT}`);
});
