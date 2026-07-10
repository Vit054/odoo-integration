// Node.js PostgreSQL Connection Helper for Odoo
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
  host: process.env.ODOO_DB_HOST,
  port: process.env.ODOO_DB_PORT,
  user: process.env.ODOO_DB_USER,
  password: process.env.ODOO_DB_PASSWORD,
  database: process.env.ODOO_DB_NAME,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

// Query wrapper with error handling
async function query(sql, params = []) {
  try {
    const result = await pool.query(sql, params);
    return { success: true, data: result.rows, count: result.rowCount };
  } catch (error) {
    console.error('Database query error:', error);
    return { success: false, error: error.message };
  }
}

// Get all tables in Odoo database
async function getTables() {
  const sql = `
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY table_name
  `;
  return query(sql);
}

// Get table schema
async function getTableSchema(tableName) {
  const sql = `
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name = $1
    ORDER BY ordinal_position
  `;
  return query(sql, [tableName]);
}

// Generic query executor
async function executeQuery(sql) {
  return query(sql);
}

// Close connection pool
async function close() {
  await pool.end();
}

module.exports = {
  pool,
  query,
  getTables,
  getTableSchema,
  executeQuery,
  close
};
