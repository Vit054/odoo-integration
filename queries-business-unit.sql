-- Odoo Business Unit Queries
-- สำหรับการดึงข้อมูลแยกตาม business unit / company

-- 1. List all Business Units (Companies)
SELECT
  id,
  name,
  code,
  parent_id  -- parent company if multi-level structure
FROM res_company
WHERE active = true
ORDER BY name;

-- 2. Today's Sales by Business Unit
SELECT
  rc.id as bu_id,
  rc.code as bu_code,
  rc.name as bu_name,
  COALESCE(SUM(so.amount_total), 0) as todaySales
FROM res_company rc
LEFT JOIN sale_order so ON so.company_id = rc.id
  AND so.state = 'done'
  AND DATE(so.date_order) = CURRENT_DATE
WHERE rc.active = true
GROUP BY rc.id, rc.code, rc.name
ORDER BY rc.name;

-- 3. Pending Orders by Business Unit
SELECT
  rc.id as bu_id,
  rc.code as bu_code,
  rc.name as bu_name,
  COUNT(so.id) as pendingOrders
FROM res_company rc
LEFT JOIN sale_order so ON so.company_id = rc.id
  AND (so.state = 'draft' OR so.state = 'sent')
WHERE rc.active = true
GROUP BY rc.id, rc.code, rc.name
ORDER BY rc.name;

-- 4. Inventory Value by Business Unit
SELECT
  rc.id as bu_id,
  rc.code as bu_code,
  rc.name as bu_name,
  COALESCE(SUM(sq.quantity * pp.standard_price), 0) as inventoryValue
FROM res_company rc
LEFT JOIN stock_quant sq ON sq.company_id = rc.id
LEFT JOIN product_product pp ON pp.id = sq.product_id
WHERE rc.active = true
  AND pp.active = true
GROUP BY rc.id, rc.code, rc.name
ORDER BY rc.name;

-- 5. Revenue YTD by Business Unit
SELECT
  rc.id as bu_id,
  rc.code as bu_code,
  rc.name as bu_name,
  COALESCE(SUM(so.amount_total), 0) as revenueYTD
FROM res_company rc
LEFT JOIN sale_order so ON so.company_id = rc.id
  AND so.state = 'done'
  AND DATE_PART('year', so.date_order) = DATE_PART('year', CURRENT_DATE)
WHERE rc.active = true
GROUP BY rc.id, rc.code, rc.name
ORDER BY rc.name;

-- 6. Sales Trend for Specific Business Unit (with bu_code parameter)
SELECT
  DATE(so.date_order) as date,
  SUM(so.amount_total) as amount,
  rc.code as bu_code
FROM sale_order so
JOIN res_company rc ON rc.id = so.company_id
WHERE rc.code = $1  -- Parameter: business unit code
  AND so.state = 'done'
  AND so.date_order >= CURRENT_DATE - INTERVAL '7 days'
GROUP BY DATE(so.date_order), rc.code
ORDER BY date;

-- 7. Top Products by Business Unit
SELECT
  rc.code as bu_code,
  rc.name as bu_name,
  pp.id,
  pt.name as product_name,
  SUM(sol.product_uom_qty) as unitsSold,
  SUM(sol.price_subtotal) as revenue,
  CASE
    WHEN COALESCE(sq.quantity, 0) < pp.minimum_qty THEN 'out_of_stock'
    WHEN COALESCE(sq.quantity, 0) < pp.minimum_qty * 1.5 THEN 'low_stock'
    ELSE 'in_stock'
  END as status
FROM sale_order_line sol
JOIN sale_order so ON so.id = sol.order_id
JOIN res_company rc ON rc.id = so.company_id
JOIN product_product pp ON pp.id = sol.product_id
JOIN product_template pt ON pt.id = pp.product_tmpl_id
LEFT JOIN stock_quant sq ON sq.product_id = pp.id
  AND sq.company_id = rc.id
WHERE so.state = 'done'
  AND DATE_PART('month', so.date_order) = DATE_PART('month', CURRENT_DATE)
  AND DATE_PART('year', so.date_order) = DATE_PART('year', CURRENT_DATE)
  AND rc.code = $1  -- Parameter: business unit code
GROUP BY rc.code, rc.name, pp.id, pt.name, sq.quantity, pp.minimum_qty
ORDER BY revenue DESC
LIMIT 5;

-- 8. Recent Orders by Business Unit
SELECT
  rc.code as bu_code,
  rc.name as bu_name,
  so.name as order_id,
  rp.name as customer_name,
  so.amount_total as amount,
  so.state as status,
  DATE(so.create_date) as order_date
FROM sale_order so
JOIN res_company rc ON rc.id = so.company_id
JOIN res_partner rp ON rp.id = so.partner_id
WHERE rc.code = $1  -- Parameter: business unit code
ORDER BY so.create_date DESC
LIMIT 10;

-- 9. Low Stock Alert by Business Unit
SELECT
  rc.code as bu_code,
  rc.name as bu_name,
  COUNT(pp.id) as lowStockCount,
  STRING_AGG(pt.name, ', ') as product_list
FROM product_product pp
JOIN product_template pt ON pt.id = pp.product_tmpl_id
JOIN res_company rc ON rc.id = pp.company_id
LEFT JOIN stock_quant sq ON sq.product_id = pp.id
WHERE pp.active = true
  AND COALESCE(sq.quantity, 0) < pp.minimum_qty
GROUP BY rc.code, rc.name
HAVING COUNT(pp.id) > 0
ORDER BY rc.name;

-- 10. Manager/Responsible Person for Business Unit
SELECT
  rc.id,
  rc.code,
  rc.name,
  rp.name as manager_name,
  rp.email as manager_email,
  rp.phone as manager_phone
FROM res_company rc
LEFT JOIN res_partner rp ON rp.id = rc.partner_id
WHERE rc.active = true
ORDER BY rc.name;

-- Notes:
-- - res_company = Business Units/Companies in Odoo
-- - company_id = Foreign key linking records to company
-- - ในการ filter ตามสาขา ใช้ company_id หรือ rc.code
-- - สำหรับ multi-level company ให้ใช้ UNION กับ parent_id
-- - อาจต้องแก้ไข stock_quant การ filter ตาม location หรือ warehouse
