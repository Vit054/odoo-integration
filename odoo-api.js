// Express API Routes for Odoo Database
const express = require('express');
const router = express.Router();
const odoo = require('./odoo-connection');

// GET /api/odoo/tables - List all tables
router.get('/tables', async (req, res) => {
  const result = await odoo.getTables();
  res.json(result);
});

// GET /api/odoo/schema/:tableName - Get table schema
router.get('/schema/:tableName', async (req, res) => {
  const { tableName } = req.params;
  const result = await odoo.getTableSchema(tableName);
  res.json(result);
});

// POST /api/odoo/query - Execute custom query
// Body: { sql: "SELECT * FROM res_partner LIMIT 10" }
router.post('/query', async (req, res) => {
  const { sql } = req.body;

  if (!sql || typeof sql !== 'string') {
    return res.status(400).json({
      success: false,
      error: 'SQL query required in request body'
    });
  }

  // Basic security: prevent dangerous operations
  const dangerous = ['DROP', 'DELETE', 'TRUNCATE', 'ALTER'];
  if (dangerous.some(op => sql.toUpperCase().includes(op))) {
    return res.status(403).json({
      success: false,
      error: 'Dangerous operations not allowed. Use SELECT queries only.'
    });
  }

  const result = await odoo.executeQuery(sql);
  res.json(result);
});

// GET /api/odoo/data/:table - Fetch data from table
// Query params: limit=10, offset=0, filter={"name":"test"}
router.get('/data/:table', async (req, res) => {
  const { table } = req.params;
  const { limit = 50, offset = 0 } = req.query;

  let sql = `SELECT * FROM ${table}`;
  const params = [];

  // Simple WHERE clause from filter param (JSON)
  if (req.query.filter) {
    try {
      const filter = JSON.parse(req.query.filter);
      const conditions = Object.keys(filter)
        .map((key, idx) => `${key} = $${idx + 1}`)
        .join(' AND ');
      const values = Object.values(filter);

      sql += ` WHERE ${conditions}`;
      params.push(...values);
    } catch (e) {
      return res.status(400).json({ success: false, error: 'Invalid filter JSON' });
    }
  }

  sql += ` LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(limit, offset);

  const result = await odoo.query(sql, params);
  res.json(result);
});

// GET /api/odoo/count/:table - Count records in table
router.get('/count/:table', async (req, res) => {
  const { table } = req.params;
  const sql = `SELECT COUNT(*) as count FROM ${table}`;
  const result = await odoo.query(sql);
  res.json(result);
});

module.exports = router;
