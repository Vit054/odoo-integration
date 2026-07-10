// Express API Routes for Odoo Database (Odoo 14 — odoo_cff_golive)
const express = require('express');
const router = express.Router();
const odoo = require('./odoo-connection');

// Bangkok-local date expression for a UTC timestamp column
const BKK = (col) => `(${col} AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Bangkok')`;
const CONFIRMED = `so.state IN ('sale','done')`;

// Simple in-memory cache (dashboard queries hit prod DB)
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

// GET /api/odoo/business-units - sales teams that have volume this year
router.get('/business-units', async (req, res) => {
  try {
    const data = await cached('business-units', async () => {
      const r = await odoo.query(`
        SELECT ct.id, ct.name,
               COUNT(so.id)::int AS orders,
               COALESCE(SUM(so.amount_total),0)::float AS total
        FROM crm_team ct
        LEFT JOIN sale_order so ON so.team_id = ct.id
          AND ${CONFIRMED}
          AND ${BKK('so.date_order')}::date >= date_trunc('year', (now() AT TIME ZONE 'Asia/Bangkok'))::date
        GROUP BY ct.id, ct.name
        HAVING COUNT(so.id) > 0
        ORDER BY SUM(so.amount_total) DESC NULLS LAST
      `);
      if (!r.success) throw new Error(r.error);
      return r.data;
    });
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/odoo/dashboard?teamId=N - executive dashboard data
router.get('/dashboard', async (req, res) => {
  const teamIdRaw = req.query.teamId;
  let teamId = null;
  if (teamIdRaw && teamIdRaw !== 'all') {
    teamId = parseInt(teamIdRaw, 10);
    if (!Number.isInteger(teamId)) {
      return res.status(400).json({ success: false, error: 'teamId must be an integer or "all"' });
    }
  }

  try {
    const data = await cached(`dashboard:${teamId || 'all'}`, () => buildDashboard(teamId));
    res.json({ success: true, data });
  } catch (e) {
    console.error('dashboard error:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

async function one(sql, params) {
  const r = await odoo.query(sql, params);
  if (!r.success) throw new Error(r.error);
  return r.data;
}

async function buildDashboard(teamId) {
  const p = teamId ? [teamId] : [];
  const soTeam = teamId ? 'AND so.team_id = $1' : '';
  const amTeam = teamId ? 'AND am.team_id = $1' : '';

  const [todayRows, yesterdayRows, pendingRows, revenueRows, trendRows,
         topProducts, recentOrders, lowStockRows, inventoryRows, posRows] = await Promise.all([

    // Today's confirmed sales (Bangkok date)
    one(`SELECT COUNT(*)::int AS orders, COALESCE(SUM(so.amount_total),0)::float AS total
         FROM sale_order so
         WHERE ${CONFIRMED} ${soTeam}
           AND ${BKK('so.date_order')}::date = (now() AT TIME ZONE 'Asia/Bangkok')::date`, p),

    // Yesterday (for % change)
    one(`SELECT COALESCE(SUM(so.amount_total),0)::float AS total
         FROM sale_order so
         WHERE ${CONFIRMED} ${soTeam}
           AND ${BKK('so.date_order')}::date = (now() AT TIME ZONE 'Asia/Bangkok')::date - 1`, p),

    // Pending quotations (pipeline)
    one(`SELECT COUNT(*)::int AS n, COALESCE(SUM(so.amount_total),0)::float AS total
         FROM sale_order so
         WHERE so.state IN ('draft','sent') ${soTeam}`, p),

    // Revenue YTD from posted customer invoices (company currency, refunds netted)
    one(`SELECT COALESCE(SUM(am.amount_untaxed_signed),0)::float AS revenue
         FROM account_move am
         WHERE am.move_type IN ('out_invoice','out_refund') AND am.state = 'posted' ${amTeam}
           AND date_part('year', am.invoice_date) = date_part('year', (now() AT TIME ZONE 'Asia/Bangkok'))`, p),

    // 14-day sales trend
    one(`SELECT to_char(${BKK('so.date_order')}::date, 'YYYY-MM-DD') AS date,
                COUNT(*)::int AS orders, COALESCE(SUM(so.amount_total),0)::float AS amount
         FROM sale_order so
         WHERE ${CONFIRMED} ${soTeam}
           AND ${BKK('so.date_order')}::date >= (now() AT TIME ZONE 'Asia/Bangkok')::date - 13
         GROUP BY 1 ORDER BY 1`, p),

    // Top products this month
    one(`SELECT pt.name, SUM(sol.product_uom_qty)::float AS qty,
                SUM(sol.price_subtotal)::float AS revenue
         FROM sale_order_line sol
         JOIN sale_order so ON so.id = sol.order_id
         JOIN product_product pp ON pp.id = sol.product_id
         JOIN product_template pt ON pt.id = pp.product_tmpl_id
         WHERE ${CONFIRMED} ${soTeam}
           AND date_trunc('month', ${BKK('so.date_order')}) = date_trunc('month', (now() AT TIME ZONE 'Asia/Bangkok'))
         GROUP BY pt.name ORDER BY revenue DESC LIMIT 8`, p),

    // Recent orders
    one(`SELECT so.name AS id, rp.name AS customer, so.amount_total::float AS amount,
                so.state, ct.name AS team,
                to_char(${BKK('so.date_order')}, 'DD/MM HH24:MI') AS date
         FROM sale_order so
         JOIN res_partner rp ON rp.id = so.partner_id
         LEFT JOIN crm_team ct ON ct.id = so.team_id
         WHERE so.state != 'cancel' ${soTeam}
         ORDER BY so.date_order DESC LIMIT 10`, p),

    // Low stock (reordering rules) - company-wide
    one(`SELECT pt.name, COALESCE(SUM(sq.quantity),0)::float AS on_hand,
                op.product_min_qty::float AS min_qty
         FROM stock_warehouse_orderpoint op
         JOIN product_product pp ON pp.id = op.product_id
         JOIN product_template pt ON pt.id = pp.product_tmpl_id
         LEFT JOIN stock_quant sq ON sq.product_id = op.product_id
           AND sq.location_id IN (SELECT id FROM stock_location WHERE usage='internal')
         GROUP BY pt.name, op.product_min_qty
         HAVING COALESCE(SUM(sq.quantity),0) < op.product_min_qty
         ORDER BY (op.product_min_qty - COALESCE(SUM(sq.quantity),0)) DESC
         LIMIT 10`),

    // Inventory value (stock valuation layers) - company-wide
    one(`SELECT COALESCE(SUM(remaining_value),0)::float AS value FROM stock_valuation_layer`),

    // POS sales today - company-wide channel
    one(`SELECT COUNT(*)::int AS orders, COALESCE(SUM(po.amount_total),0)::float AS total
         FROM pos_order po
         WHERE po.state IN ('paid','done','invoiced')
           AND ${BKK('po.date_order')}::date = (now() AT TIME ZONE 'Asia/Bangkok')::date`),
  ]);

  const todaySales = todayRows[0].total;
  const yesterdaySales = yesterdayRows[0].total;
  const salesTrendPct = yesterdaySales > 0
    ? ((todaySales - yesterdaySales) / yesterdaySales) * 100
    : null;

  const alerts = [];
  if (lowStockRows.length > 0) {
    alerts.push({
      id: 'low-stock', type: 'warning',
      title: `สินค้าใกล้หมดสต๊อก ${lowStockRows.length} รายการ`,
      message: lowStockRows.slice(0, 3).map((r) => r.name).join(', ') + (lowStockRows.length > 3 ? ' …' : ''),
    });
  }
  if (pendingRows[0].n > 0) {
    alerts.push({
      id: 'pending', type: 'info',
      title: `ใบเสนอราคารอยืนยัน ${pendingRows[0].n} ใบ`,
      message: `มูลค่ารวม ฿${Math.round(pendingRows[0].total).toLocaleString()}`,
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    teamId: teamId || 'all',
    metrics: {
      todaySales,
      todayOrders: todayRows[0].orders,
      yesterdaySales,
      salesTrendPct,
      pendingOrders: pendingRows[0].n,
      pendingValue: pendingRows[0].total,
      revenueYTD: revenueRows[0].revenue,
      inventoryValue: inventoryRows[0].value,
      posToday: posRows[0].total,
      posOrdersToday: posRows[0].orders,
    },
    charts: { salesTrend: trendRows },
    topProducts,
    recentOrders,
    lowStock: lowStockRows,
    alerts,
  };
}

// ---------------------------------------------------------------------------
// Generic/dev endpoints (read-only)

// GET /api/odoo/tables - List all tables
router.get('/tables', async (req, res) => {
  const result = await odoo.getTables();
  res.json(result);
});

// GET /api/odoo/schema/:tableName - Get table schema
router.get('/schema/:tableName', async (req, res) => {
  const result = await odoo.getTableSchema(req.params.tableName);
  res.json(result);
});

// POST /api/odoo/query - Execute custom read-only query
router.post('/query', async (req, res) => {
  const { sql } = req.body;

  if (!sql || typeof sql !== 'string') {
    return res.status(400).json({ success: false, error: 'SQL query required in request body' });
  }

  // Read-only enforcement: single statement, must start with SELECT or WITH
  const trimmed = sql.trim().replace(/;\s*$/, '');
  if (trimmed.includes(';') || !/^(SELECT|WITH)\b/i.test(trimmed)) {
    return res.status(403).json({
      success: false,
      error: 'Only single SELECT/WITH queries are allowed.',
    });
  }

  const result = await odoo.executeQuery(trimmed);
  res.json(result);
});

module.exports = router;
