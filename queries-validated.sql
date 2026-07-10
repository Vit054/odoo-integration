-- ==========================================================================
-- Query หลักของ dashboard — ตรวจสอบกับข้อมูลจริงแล้ว (Odoo 14, odoo_cff_golive)
-- หลักการ: ยอดขาย = ใบแจ้งหนี้ posted หัก CN, ยอดก่อน VAT สกุลเงินบริษัท
--   -aml.balance  (invoice เป็นบวก, CN เป็นลบ) — ตรงกับ amount_untaxed_signed
-- Business Unit: account_move_line.business_unit_id -> cu_business_unit
-- ==========================================================================

-- 1. ยอด Invoice / CN / สุทธิ แยกตาม Business Unit (เดือนนี้)
SELECT COALESCE(bu.name, '(ไม่ระบุ BU)')                                    AS business_unit,
       SUM(CASE WHEN am.move_type='out_invoice' THEN -aml.balance ELSE 0 END) AS invoice,
       SUM(CASE WHEN am.move_type='out_refund'  THEN  aml.balance ELSE 0 END) AS cn,
       SUM(-aml.balance)                                                      AS net,
       COUNT(DISTINCT am.id) FILTER (WHERE am.move_type='out_invoice')        AS invoice_count,
       COUNT(DISTINCT am.id) FILTER (WHERE am.move_type='out_refund')         AS cn_count
FROM account_move_line aml
JOIN account_move am ON am.id = aml.move_id
LEFT JOIN cu_business_unit bu ON bu.id = aml.business_unit_id
WHERE am.move_type IN ('out_invoice','out_refund')
  AND am.state = 'posted'
  AND aml.exclude_from_invoice_tab = false
  AND aml.display_type IS NULL
  AND date_trunc('month', am.invoice_date) =
      date_trunc('month', (now() AT TIME ZONE 'Asia/Bangkok')::date)
GROUP BY 1
ORDER BY net DESC;
-- เปลี่ยนช่วงเวลา:
--   วันนี้: am.invoice_date = (now() AT TIME ZONE 'Asia/Bangkok')::date
--   ปีนี้:  date_part('year', am.invoice_date) = date_part('year', (now() AT TIME ZONE 'Asia/Bangkok'))

-- 2. แนวโน้มยอดสุทธิรายวัน 14 วัน
SELECT am.invoice_date::text AS date,
       SUM(CASE WHEN am.move_type='out_invoice' THEN -aml.balance ELSE 0 END) AS invoice,
       SUM(CASE WHEN am.move_type='out_refund'  THEN  aml.balance ELSE 0 END) AS cn,
       SUM(-aml.balance) AS net
FROM account_move_line aml
JOIN account_move am ON am.id = aml.move_id
WHERE am.move_type IN ('out_invoice','out_refund') AND am.state='posted'
  AND aml.exclude_from_invoice_tab = false AND aml.display_type IS NULL
  AND am.invoice_date >= (now() AT TIME ZONE 'Asia/Bangkok')::date - 13
GROUP BY am.invoice_date ORDER BY am.invoice_date;

-- 3. สินค้าขายดี (ยอดสุทธิ เดือนนี้)
SELECT pt.name, SUM(aml.quantity) AS qty, SUM(-aml.balance) AS revenue
FROM account_move_line aml
JOIN account_move am ON am.id = aml.move_id
JOIN product_product pp ON pp.id = aml.product_id
JOIN product_template pt ON pt.id = pp.product_tmpl_id
WHERE am.move_type IN ('out_invoice','out_refund') AND am.state='posted'
  AND aml.exclude_from_invoice_tab = false AND aml.display_type IS NULL
  AND date_trunc('month', am.invoice_date) =
      date_trunc('month', (now() AT TIME ZONE 'Asia/Bangkok')::date)
GROUP BY pt.name ORDER BY revenue DESC LIMIT 8;

-- 4. เอกสารล่าสุด (Invoice/CN) พร้อม BU
SELECT am.name, rp.name AS customer, am.amount_untaxed_signed AS amount,
       am.move_type, am.invoice_date,
       (SELECT string_agg(DISTINCT b2.name, ', ')
        FROM account_move_line l2
        JOIN cu_business_unit b2 ON b2.id = l2.business_unit_id
        WHERE l2.move_id = am.id) AS business_units
FROM account_move am
JOIN res_partner rp ON rp.id = am.partner_id
WHERE am.move_type IN ('out_invoice','out_refund') AND am.state='posted'
ORDER BY am.invoice_date DESC, am.id DESC LIMIT 10;

-- 5. มูลค่าสต๊อกคงคลัง (ตามมูลค่าทางบัญชี)
SELECT SUM(remaining_value) AS inventory_value FROM stock_valuation_layer;

-- 6. ยอดขาย POS วันนี้ (แยกช่องทาง — ไม่รวมใน invoice)
SELECT COUNT(*) AS orders, COALESCE(SUM(amount_total),0) AS total
FROM pos_order
WHERE state IN ('paid','done','invoiced')
  AND (date_order AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Bangkok')::date =
      (now() AT TIME ZONE 'Asia/Bangkok')::date;

-- 7. สินค้าใกล้หมดสต๊อก (ตาม reordering rules)
SELECT pt.name, COALESCE(SUM(sq.quantity),0) AS on_hand, op.product_min_qty
FROM stock_warehouse_orderpoint op
JOIN product_product pp ON pp.id = op.product_id
JOIN product_template pt ON pt.id = pp.product_tmpl_id
LEFT JOIN stock_quant sq ON sq.product_id = op.product_id
  AND sq.location_id IN (SELECT id FROM stock_location WHERE usage='internal')
GROUP BY pt.name, op.product_min_qty
HAVING COALESCE(SUM(sq.quantity),0) < op.product_min_qty
ORDER BY (op.product_min_qty - COALESCE(SUM(sq.quantity),0)) DESC;

-- 8. ใบแจ้งหนี้ค้าง Draft (ยังไม่ถูกนับในยอดขาย)
SELECT COUNT(*) AS draft_invoices FROM account_move
WHERE move_type = 'out_invoice' AND state = 'draft';

-- --------------------------------------------------------------------------
-- หมายเหตุ schema ที่เจอจริงใน DB นี้ (กันหลงในอนาคต):
-- * DB ชื่อ odoo_cff_golive (ไม่ใช่ odoo)
-- * บริษัทที่มียอด = CITY FRESH FRUIT (company_id=1) เท่านั้น
-- * sale_order มีอยู่ (state หลัก = 'done') แต่ dashboard ไม่ใช้ — ผู้ใช้ต้องการยอดจาก invoice
-- * crm_team = ทีมขาย (B2B/B2C/รายบุคคล) — คนละเรื่องกับ Business Unit
-- * ห้ามใช้ price_subtotal รวมยอดข้ามสกุลเงิน (invoice USD จะเพี้ยน) — ใช้ balance
