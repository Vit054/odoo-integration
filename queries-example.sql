-- Odoo Dashboard Queries
-- เลือก queries ที่ต้องการและแก้ไขตามตรรกะ business ของคุณ

-- 1. Today's Sales (วันนี้)
SELECT
  COALESCE(SUM(amount_total), 0) as todaySales
FROM sale_order
WHERE state = 'done'
  AND DATE(date_order) = CURRENT_DATE;

-- 2. Pending Orders (รอดำเนินการ)
SELECT
  COUNT(*) as pendingOrders
FROM sale_order
WHERE state = 'draft' OR state = 'sent';

-- 3. Inventory Value (มูลค่าคงคลังทั้งหมด)
SELECT
  COALESCE(SUM(quantity_on_hand * standard_price), 0) as inventoryValue
FROM product_product
WHERE active = true;

-- 4. Revenue YTD (รายรับประจำปี)
SELECT
  COALESCE(SUM(amount_total), 0) as revenueYTD
FROM sale_order
WHERE state = 'done'
  AND DATE_PART('year', date_order) = DATE_PART('year', CURRENT_DATE);

-- 5. Sales Trend (7 วันที่ผ่านมา)
SELECT
  DATE(date_order) as date,
  SUM(amount_total) as amount
FROM sale_order
WHERE state = 'done'
  AND date_order >= CURRENT_DATE - INTERVAL '7 days'
GROUP BY DATE(date_order)
ORDER BY date;

-- 6. Top Products This Month
SELECT
  pp.id,
  pt.name,
  SUM(sol.product_uom_qty) as unitsSold,
  SUM(sol.price_subtotal) as revenue,
  CASE
    WHEN sq.quantity < pp.minimum_qty THEN 'out_of_stock'
    WHEN sq.quantity < pp.minimum_qty * 1.5 THEN 'low_stock'
    ELSE 'in_stock'
  END as status
FROM sale_order_line sol
JOIN product_product pp ON pp.id = sol.product_id
JOIN product_template pt ON pt.id = pp.product_tmpl_id
LEFT JOIN stock_quant sq ON sq.product_id = pp.id
WHERE sol.order_id IN (
  SELECT id FROM sale_order WHERE state = 'done'
  AND DATE_PART('month', date_order) = DATE_PART('month', CURRENT_DATE)
  AND DATE_PART('year', date_order) = DATE_PART('year', CURRENT_DATE)
)
GROUP BY pp.id, pt.name, sq.quantity, pp.minimum_qty
ORDER BY revenue DESC
LIMIT 5;

-- 7. Recent Orders
SELECT
  so.name as id,
  rp.name as customer,
  so.amount_total as amount,
  so.state as status,
  DATE(so.create_date) as date
FROM sale_order so
JOIN res_partner rp ON rp.id = so.partner_id
ORDER BY so.create_date DESC
LIMIT 10;

-- 8. Low Stock Alert
SELECT
  COUNT(*) as lowStockCount
FROM product_product pp
WHERE quantity_on_hand < minimum_qty
  AND active = true;

-- 9. Pending Orders Alert
SELECT
  COUNT(*) as pendingCount
FROM sale_order
WHERE state IN ('draft', 'sent');

-- 10. Sales Change vs Yesterday
SELECT
  (SELECT COALESCE(SUM(amount_total), 0)
   FROM sale_order
   WHERE state = 'done' AND DATE(date_order) = CURRENT_DATE) as todaySales,
  (SELECT COALESCE(SUM(amount_total), 0)
   FROM sale_order
   WHERE state = 'done' AND DATE(date_order) = CURRENT_DATE - 1) as yesterdaySales;

-- Notes:
-- - แก้ไข table names ตามว่า Odoo version และ module ของคุณใช้อะไร
-- - อาจจำเป็นต้อง JOIN กับ company หากเป็น multi-company setup
-- - ปรับวันที่/เงื่อนไขตามต้องการ
-- - สำหรับ Odoo 17+: ใช้ account.move แทน account.invoice
-- - สำหรับ stock: ตรวจสอบว่าใช้ stock_quant หรือ product.product.qty_available
