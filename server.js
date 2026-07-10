// Express Server with Odoo API Routes
const express = require('express');
const dotenv = require('dotenv');

dotenv.config({ path: '.env.local' });

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// Import Odoo API routes
const odooApi = require('./odoo-api');
app.use('/api/odoo', odooApi);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Odoo API server is running' });
});

// Root endpoint - API documentation
app.get('/', (req, res) => {
  res.json({
    name: 'Odoo Database API',
    version: '1.0.0',
    endpoints: {
      'GET /api/odoo/tables': 'List all database tables',
      'GET /api/odoo/schema/:tableName': 'Get table schema (columns, types)',
      'GET /api/odoo/data/:table': 'Fetch table data (limit, offset, filter)',
      'GET /api/odoo/count/:table': 'Count records in table',
      'POST /api/odoo/query': 'Execute custom SELECT query (body: {sql: "..."})',
      'GET /health': 'Server health check'
    },
    examples: {
      'Get partners': 'GET /api/odoo/data/res_partner?limit=10&offset=0',
      'Get partner schema': 'GET /api/odoo/schema/res_partner',
      'Filter data': 'GET /api/odoo/data/res_partner?filter={"active":true}',
      'Custom query': 'POST /api/odoo/query with body {"sql": "SELECT id, name FROM res_partner LIMIT 5"}'
    }
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`✓ Odoo API server running on port ${PORT}`);
  console.log(`  Visit http://localhost:${PORT} for API documentation`);
});
