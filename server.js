// Express Server: Odoo Executive Dashboard + API
const path = require('path');
const express = require('express');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '.env.local') });

const app = express();
const PORT = process.env.PORT || 3000;

// PUBLIC_MODE=1 = ตัวที่ deploy บน VPS ให้ทีมภายนอกเรียกผ่าน https://flowtica.link/odoo-api/
// เปิดเฉพาะ API ชุดภายนอก + บังคับ token ทุก request, ไม่เสิร์ฟหน้าเว็บ/ไฟล์ใน public/ เลย
const PUBLIC_MODE = process.env.PUBLIC_MODE === '1';

app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(express.json({ limit: '1mb' }));

if (!PUBLIC_MODE) {
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
  // Data Insight: ลูกค้า/สินค้า/ช่องทาง (behind Apache = /Odoo/insights)
  app.get('/insights', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'insights.html'));
  });
}

// Odoo API routes
const odooApi = require('./odoo-api');
if (PUBLIC_MODE) {
  const { createPublicGuard } = require('./public-guard');
  app.use('/api/odoo', createPublicGuard());   // throw ทิ้งตั้งแต่ boot ถ้าไม่ได้ตั้ง API_TOKENS
}
app.use('/api/odoo', odooApi);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Odoo dashboard server is running' });
});

// API documentation (ภายในเท่านั้น — โหมดสาธารณะไม่บอกว่ามี endpoint อะไรอยู่บ้าง)
app.get('/api', (req, res) => {
  if (PUBLIC_MODE) {
    return res.json({
      name: 'CFF Odoo API',
      mode: 'public',
      endpoints: {
        'GET /api/odoo/tables': 'รายชื่อตาราง',
        'GET /api/odoo/schema/:tableName': 'โครงสร้างคอลัมน์',
        'POST /api/odoo/query': 'SELECT/WITH อ่านอย่างเดียว {sql: "..."}',
        'POST /api/odoo/insert/:table': 'INSERT (ต้องใช้ admin token + เปิดตารางไว้ก่อน)',
        'GET /health': 'Health check',
      },
      auth: 'ทุก endpoint ต้องส่ง Authorization: Bearer <token>',
    });
  }
  res.json({
    name: 'Odoo Dashboard API',
    version: '2.1.0',
    endpoints: {
      'GET /': 'Executive dashboard UI',
      'GET /APIGuide': 'API guideline สำหรับทีมภายนอก (หน้าเว็บ + ลิงก์ PDF/OpenAPI/Postman)',
      'GET /api/odoo/dashboard?teamId=all|N': 'Dashboard data (real-time, 60s cache)',
      'GET /insights': 'หน้า Data Insight (ลูกค้า/สินค้า/ช่องทาง/campaign)',
      'GET /api/odoo/insights': 'ข้อมูล insight ทั้งชุด (cache 5 นาที)',
      'GET /api/odoo/sales-compare?bu=all|<BU>&years=5': 'เปรียบเทียบยอดขายรายปี (YoY) และเดือนต่อเดือน (MoM)',
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

// โหมดสาธารณะผูกกับ 127.0.0.1 เท่านั้น — ออกเน็ตผ่าน Caddy/proxy ชั้นบนเสมอ
const HOST = process.env.BIND_HOST || (PUBLIC_MODE ? '127.0.0.1' : '0.0.0.0');
app.listen(PORT, HOST, () => {
  console.log(`✓ Odoo ${PUBLIC_MODE ? 'public API' : 'dashboard'} server running on ${HOST}:${PORT}`);
});
