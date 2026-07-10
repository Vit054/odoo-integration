// Express API Routes for Odoo Database (Odoo 14 — odoo_cff_golive)
// ยอดขายอิงจากใบแจ้งหนี้ (posted customer invoices) หัก CN, แยกตาม Business Unit
// (custom field: account_move_line.business_unit_id -> cu_business_unit)
const express = require('express');
const router = express.Router();
const odoo = require('./odoo-connection');
const configStore = require('./config-store');

// Bangkok "today" (invoice_date is a DATE column — no TZ conversion needed on it)
const TODAY_BKK = `(now() AT TIME ZONE 'Asia/Bangkok')::date`;

// Product lines of posted customer invoices / credit notes
const DOC_BASE = `
  FROM account_move_line aml
  JOIN account_move am ON am.id = aml.move_id
  LEFT JOIN cu_business_unit bu ON bu.id = aml.business_unit_id
  WHERE am.move_type IN ('out_invoice','out_refund')
    AND am.state = 'posted'
    AND aml.exclude_from_invoice_tab = false
    AND aml.display_type IS NULL`;

// -aml.balance = ยอดก่อน VAT ในสกุลเงินบริษัท (invoice บวก, CN ลบ)
const INV_AMT = `COALESCE(SUM(CASE WHEN am.move_type = 'out_invoice' THEN -aml.balance ELSE 0 END), 0)::float`;
const CN_AMT  = `COALESCE(SUM(CASE WHEN am.move_type = 'out_refund'  THEN  aml.balance ELSE 0 END), 0)::float`;
const NET_AMT = `COALESCE(SUM(-aml.balance), 0)::float`;

const PERIODS = {
  today: `AND am.invoice_date = ${TODAY_BKK}`,
  month: `AND date_trunc('month', am.invoice_date) = date_trunc('month', ${TODAY_BKK})`,
  year:  `AND date_part('year', am.invoice_date) = date_part('year', ${TODAY_BKK})`,
};

// Simple in-memory cache (queries hit prod DB)
const cache = new Map();
const CACHE_TTL_MS = 60 * 1000;
function cached(key, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return Promise.resolve(hit.data);
  return fn().then((data) => {
    cache.set(key, { at: Date.now(), data });
    return data;
  });
}

async function one(sql, params) {
  const r = await odoo.query(sql, params);
  if (!r.success) throw new Error(r.error);
  return r.data;
}

// GET /api/odoo/business-units - BU (cu_business_unit) ที่มียอดปีนี้
router.get('/business-units', async (req, res) => {
  try {
    const data = await cached('business-units', () => one(`
      SELECT bu.name, ${NET_AMT} AS net,
             COUNT(DISTINCT am.id)::int AS docs
      ${DOC_BASE}
        ${PERIODS.year}
        AND bu.name IS NOT NULL
      GROUP BY bu.name
      ORDER BY net DESC`));
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/odoo/dashboard?bu=all|<ชื่อ BU>&period=today|month|year
router.get('/dashboard', async (req, res) => {
  const period = PERIODS[req.query.period] ? req.query.period : 'month';
  const buName = req.query.bu && req.query.bu !== 'all' ? String(req.query.bu) : null;

  try {
    const data = await cached(`dashboard:${buName || 'all'}:${period}`, () =>
      buildDashboard(buName, period));
    res.json({ success: true, data });
  } catch (e) {
    console.error('dashboard error:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

async function buildDashboard(buName, period) {
  const p = buName ? [buName] : [];
  const buFilter = buName ? 'AND bu.name = $1' : '';
  const periodFilter = PERIODS[period];

  const [kpiRows, buBreakdown, trendRows, topProducts, recentDocs,
         lowStockRows, inventoryRows, posRows, draftRows] = await Promise.all([

    // KPI: invoice / CN / net + จำนวนใบ (ตามช่วงเวลา + BU)
    one(`SELECT ${INV_AMT} AS invoice, ${CN_AMT} AS cn, ${NET_AMT} AS net,
                COUNT(DISTINCT am.id) FILTER (WHERE am.move_type='out_invoice')::int AS invoice_count,
                COUNT(DISTINCT am.id) FILTER (WHERE am.move_type='out_refund')::int AS cn_count
         ${DOC_BASE} ${periodFilter} ${buFilter}`, p),

    // ตารางแยกตาม BU (ตามช่วงเวลา — แสดงทุก BU เสมอ)
    one(`SELECT COALESCE(bu.name, '(ไม่ระบุ BU)') AS bu,
                ${INV_AMT} AS invoice, ${CN_AMT} AS cn, ${NET_AMT} AS net,
                COUNT(DISTINCT am.id) FILTER (WHERE am.move_type='out_invoice')::int AS invoice_count,
                COUNT(DISTINCT am.id) FILTER (WHERE am.move_type='out_refund')::int AS cn_count
         ${DOC_BASE} ${periodFilter}
         GROUP BY 1 ORDER BY net DESC`),

    // แนวโน้ม 14 วัน (สุทธิรายวัน)
    one(`SELECT to_char(am.invoice_date, 'YYYY-MM-DD') AS date,
                ${INV_AMT} AS invoice, ${CN_AMT} AS cn, ${NET_AMT} AS net
         ${DOC_BASE} ${buFilter}
           AND am.invoice_date >= ${TODAY_BKK} - 13
         GROUP BY am.invoice_date ORDER BY am.invoice_date`, p),

    // สินค้าขายดี (สุทธิ ตามช่วงเวลา + BU)
    one(`SELECT pt.name, SUM(aml.quantity)::float AS qty, SUM(-aml.balance)::float AS revenue
         FROM account_move_line aml
         JOIN account_move am ON am.id = aml.move_id
         JOIN product_product pp ON pp.id = aml.product_id
         JOIN product_template pt ON pt.id = pp.product_tmpl_id
         LEFT JOIN cu_business_unit bu ON bu.id = aml.business_unit_id
         WHERE am.move_type IN ('out_invoice','out_refund') AND am.state='posted'
           AND aml.exclude_from_invoice_tab = false AND aml.display_type IS NULL
           ${periodFilter} ${buFilter}
         GROUP BY pt.name ORDER BY revenue DESC LIMIT 8`, p),

    // เอกสารล่าสุด (invoice + CN)
    one(`SELECT am.name AS id, rp.name AS customer,
                am.amount_untaxed_signed::float AS amount,
                am.move_type AS type,
                to_char(am.invoice_date, 'DD/MM/YYYY') AS date,
                (SELECT string_agg(DISTINCT b2.name, ', ')
                 FROM account_move_line l2
                 JOIN cu_business_unit b2 ON b2.id = l2.business_unit_id
                 WHERE l2.move_id = am.id) AS bu
         FROM account_move am
         JOIN res_partner rp ON rp.id = am.partner_id
         WHERE am.move_type IN ('out_invoice','out_refund') AND am.state = 'posted'
           ${buName ? `AND EXISTS (SELECT 1 FROM account_move_line l3
                        JOIN cu_business_unit b3 ON b3.id = l3.business_unit_id
                        WHERE l3.move_id = am.id AND b3.name = $1)` : ''}
         ORDER BY am.invoice_date DESC, am.id DESC LIMIT 10`, p),

    // สินค้าใกล้หมดสต๊อก (ทั้งบริษัท)
    one(`SELECT pt.name, COALESCE(SUM(sq.quantity),0)::float AS on_hand,
                op.product_min_qty::float AS min_qty
         FROM stock_warehouse_orderpoint op
         JOIN product_product pp ON pp.id = op.product_id
         JOIN product_template pt ON pt.id = pp.product_tmpl_id
         LEFT JOIN stock_quant sq ON sq.product_id = op.product_id
           AND sq.location_id IN (SELECT id FROM stock_location WHERE usage='internal')
         GROUP BY pt.name, op.product_min_qty
         HAVING COALESCE(SUM(sq.quantity),0) < op.product_min_qty
         ORDER BY (op.product_min_qty - COALESCE(SUM(sq.quantity),0)) DESC LIMIT 10`),

    // มูลค่าสต๊อก (ทั้งบริษัท)
    one(`SELECT COALESCE(SUM(remaining_value),0)::float AS value FROM stock_valuation_layer`),

    // POS วันนี้ (ทั้งบริษัท)
    one(`SELECT COUNT(*)::int AS orders, COALESCE(SUM(po.amount_total),0)::float AS total
         FROM pos_order po
         WHERE po.state IN ('paid','done','invoiced')
           AND (po.date_order AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Bangkok')::date = ${TODAY_BKK}`),

    // ใบแจ้งหนี้ค้าง draft
    one(`SELECT COUNT(*)::int AS n FROM account_move
         WHERE move_type = 'out_invoice' AND state = 'draft'`),
  ]);

  const k = kpiRows[0];

  const alerts = [];
  if (lowStockRows.length > 0) {
    alerts.push({
      id: 'low-stock', type: 'warning',
      title: `สินค้าใกล้หมดสต๊อก ${lowStockRows.length} รายการ`,
      message: lowStockRows.slice(0, 3).map((r) => r.name).join(', ') + (lowStockRows.length > 3 ? ' …' : ''),
    });
  }
  if (k.cn_count > 0) {
    alerts.push({
      id: 'cn', type: 'info',
      title: `CN ในช่วงนี้ ${k.cn_count} ใบ`,
      message: `มูลค่ารวม ฿${Math.round(k.cn).toLocaleString()}`,
    });
  }
  if (draftRows[0].n > 0) {
    alerts.push({
      id: 'draft', type: 'info',
      title: `ใบแจ้งหนี้ค้าง Draft ${draftRows[0].n} ใบ`,
      message: 'ยังไม่ได้ Post — ไม่ถูกนับในยอดขาย',
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    bu: buName || 'all',
    period,
    metrics: {
      invoice: k.invoice,
      cn: k.cn,
      net: k.net,
      invoiceCount: k.invoice_count,
      cnCount: k.cn_count,
      inventoryValue: inventoryRows[0].value,
      posToday: posRows[0].total,
      posOrdersToday: posRows[0].orders,
      draftInvoices: draftRows[0].n,
    },
    buBreakdown,
    charts: { trend: trendRows },
    topProducts,
    recentDocs,
    lowStock: lowStockRows,
    alerts,
  };
}

// ---------------------------------------------------------------------------
// Generic/dev endpoints (read-only)

router.get('/tables', async (req, res) => {
  const result = await odoo.getTables();
  res.json(result);
});

router.get('/schema/:tableName', async (req, res) => {
  const result = await odoo.getTableSchema(req.params.tableName);
  res.json(result);
});

router.post('/query', async (req, res) => {
  const { sql } = req.body;
  if (!sql || typeof sql !== 'string') {
    return res.status(400).json({ success: false, error: 'SQL query required in request body' });
  }
  const trimmed = sql.trim().replace(/;\s*$/, '');
  if (trimmed.includes(';') || !/^(SELECT|WITH)\b/i.test(trimmed)) {
    return res.status(403).json({ success: false, error: 'Only single SELECT/WITH queries are allowed.' });
  }
  const result = await odoo.executeQuery(trimmed);
  res.json(result);
});

// ---------------------------------------------------------------------------
// Write API (INSERT) — ปิดทุกตารางเป็นค่าเริ่มต้น เปิดรายตารางผ่านหน้า /config.html
// ⚠️ INSERT ตรงเข้า DB ข้าม business logic ของ Odoo — ใช้กับตารางง่าย ๆ/custom เท่านั้น

function requireToken(req, res, next) {
  const token = process.env.ADMIN_TOKEN;
  if (!token) {
    return res.status(503).json({ success: false, error: 'Write API ปิดอยู่: ยังไม่ได้ตั้ง ADMIN_TOKEN ใน .env.local' });
  }
  const h = req.headers.authorization || '';
  const provided = h.startsWith('Bearer ') ? h.slice(7) : req.headers['x-api-key'];
  if (provided !== token) {
    return res.status(401).json({ success: false, error: 'token ไม่ถูกต้องหรือไม่ได้ส่งมา (Authorization: Bearer <token>)' });
  }
  next();
}

const TABLE_RE = /^[a-z0-9_]+$/;

// GET /api/odoo/config/writable-tables - ดูรายชื่อตารางที่เปิด INSERT
router.get('/config/writable-tables', requireToken, (req, res) => {
  res.json({ success: true, data: configStore.get() });
});

// PUT /api/odoo/config/writable-tables - ตั้งรายชื่อตาราง {tables: ["t1","t2"]}
router.put('/config/writable-tables', requireToken, (req, res) => {
  const { tables } = req.body || {};
  if (!Array.isArray(tables) || tables.some((t) => typeof t !== 'string' || !TABLE_RE.test(t))) {
    return res.status(400).json({ success: false, error: 'tables ต้องเป็น array ของชื่อตาราง (a-z, 0-9, _)' });
  }
  res.json({ success: true, data: configStore.set(tables) });
});

// POST /api/odoo/insert/:table - insert ข้อมูล
// body: { data: {col: val} } หรือ { data: [{...}, {...}] } (สูงสุด 500 แถว, ทำใน transaction)
// ?dryRun=1 = แสดง SQL ที่จะรันโดยไม่ execute (ไว้ทดสอบ)
router.post('/insert/:table', requireToken, async (req, res) => {
  const table = req.params.table;
  if (!TABLE_RE.test(table)) {
    return res.status(400).json({ success: false, error: 'ชื่อตารางไม่ถูกต้อง' });
  }
  if (!configStore.get().includes(table)) {
    return res.status(403).json({
      success: false,
      error: `ตาราง "${table}" ยังไม่ได้เปิดให้ insert — เปิดได้ที่หน้า /config.html`,
    });
  }

  let rows = req.body && req.body.data;
  if (rows && !Array.isArray(rows)) rows = [rows];
  if (!rows || rows.length === 0 || rows.length > 500) {
    return res.status(400).json({ success: false, error: 'body ต้องมี data (object หรือ array 1–500 แถว)' });
  }

  try {
    // ตรวจชื่อคอลัมน์กับ schema จริง (กัน SQL injection ผ่านชื่อคอลัมน์)
    const schema = await one(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1`, [table]);
    if (schema.length === 0) {
      return res.status(404).json({ success: false, error: `ไม่พบตาราง "${table}" ใน database` });
    }
    const validCols = new Set(schema.map((r) => r.column_name));

    const statements = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        return res.status(400).json({ success: false, error: `แถวที่ ${i + 1} ต้องเป็น object {คอลัมน์: ค่า}` });
      }
      const cols = Object.keys(row).filter((k) => row[k] !== undefined);
      const bad = cols.filter((k) => !validCols.has(k));
      if (bad.length > 0) {
        return res.status(400).json({ success: false, error: `แถวที่ ${i + 1}: ไม่มีคอลัมน์ ${bad.join(', ')} ในตาราง ${table}` });
      }
      if (cols.length === 0) {
        return res.status(400).json({ success: false, error: `แถวที่ ${i + 1}: ไม่มีข้อมูล` });
      }
      const quoted = cols.map((c) => `"${c}"`).join(', ');
      const placeholders = cols.map((_, j) => `$${j + 1}`).join(', ');
      statements.push({
        sql: `INSERT INTO "${table}" (${quoted}) VALUES (${placeholders}) RETURNING *`,
        values: cols.map((c) => row[c]),
      });
    }

    if (req.query.dryRun) {
      return res.json({ success: true, dryRun: true, statements });
    }

    // รันทั้งหมดใน transaction เดียว — พังแถวไหน rollback หมด
    const client = await odoo.pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = [];
      for (const st of statements) {
        const r = await client.query(st.sql, st.values);
        inserted.push(r.rows[0]);
      }
      await client.query('COMMIT');
      res.json({ success: true, count: inserted.length, data: inserted });
    } catch (e) {
      await client.query('ROLLBACK');
      res.status(400).json({ success: false, error: e.message });
    } finally {
      client.release();
    }
  } catch (e) {
    console.error('insert error:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
