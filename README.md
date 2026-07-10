# CFF Odoo Executive Dashboard

Dashboard ผู้บริหารของ CITY FRESH FRUIT — ดึงข้อมูลจริงจาก Odoo 14 (PostgreSQL)
แสดงยอดขายจาก **ใบแจ้งหนี้หัก CN แยกตาม Business Unit** แบบใกล้เคียง realtime

**ใช้งานจริงที่:** http://192.168.101.104/Odoo

## สถาปัตยกรรม

```
ผู้ใช้ (LAN) ──> Apache :80 (intranet server 192.168.101.104)
                   │  ProxyPass /Odoo/ → 127.0.0.1:3000
                   ▼
              Express (server.js) — systemd: odoo-dashboard
                   │  - เสิร์ฟ public/dashboard.html
                   │  - API /api/odoo/* (อ่านอย่างเดียว, cache 60s)
                   ▼
              PostgreSQL ของ Odoo 14 — DB: odoo_cff_golive @ 203.151.190.135:5432
```

- ทั้งระบบเป็น **Node.js เดียว ไม่มี framework อื่น** (รองรับ Node 16 ของ server)
- ไม่มีการเขียนข้อมูลลง Odoo — SELECT อย่างเดียว + endpoint `/query` บังคับ SELECT/WITH เท่านั้น

## นิยามตัวเลข (สำคัญ)

| ตัวเลข | ที่มา |
|---|---|
| ยอด Invoice / CN / สุทธิ | `account_move_line` ของ `account_move` ประเภท `out_invoice`/`out_refund` ที่ `state='posted'` เท่านั้น (Draft ไม่นับ) |
| จำนวนเงิน | `-aml.balance` = ยอด**ก่อน VAT ในสกุลเงินบริษัท** (รองรับ invoice USD) — ตรวจสอบแล้วตรงกับ `amount_untaxed_signed` ระดับใบ 100% |
| กรองบรรทัด | `exclude_from_invoice_tab = false AND display_type IS NULL` (เฉพาะบรรทัดสินค้า) |
| Business Unit | custom field `account_move_line.business_unit_id` → ตาราง `cu_business_unit` (Modern Trade (ห้าง), Traditional trade (ยี่ปั๊ว), Horeca, CLMV, Consignment, Direct sales, Retail store, Center) — ชื่อซ้ำได้ ต้อง GROUP BY name |
| ช่วงเวลา | `invoice_date` (DATE); "วันนี้" = `(now() AT TIME ZONE 'Asia/Bangkok')::date` |
| มูลค่าสต๊อก | `SUM(remaining_value)` จาก `stock_valuation_layer` (ทั้งบริษัท) |
| POS วันนี้ | `pos_order` state paid/done/invoiced (แยกช่องทาง ไม่รวมในยอด invoice) |
| สินค้าใกล้หมด | `stock_warehouse_orderpoint` เทียบ on-hand ใน location ประเภท internal |

## API Endpoints

| Endpoint | คำอธิบาย |
|---|---|
| `GET /` | หน้า dashboard |
| `GET /api/odoo/dashboard?bu=all|<ชื่อ BU>&period=today|month|year` | ข้อมูลทั้งหน้า (KPI, ตาราง BU, เทรนด์ 14 วัน, สินค้าขายดี, เอกสารล่าสุด, แจ้งเตือน) |
| `GET /api/odoo/business-units` | รายชื่อ BU ที่มียอดปีนี้ + ยอดสุทธิ |
| `GET /api/odoo/tables`, `GET /api/odoo/schema/:table` | สำรวจ schema (dev) |
| `POST /api/odoo/query` `{sql}` | query อ่านอย่างเดียว (SELECT/WITH คำสั่งเดียว) |
| `GET /health` | health check |

## บน Server (production)

- โค้ด: `/Odoo/odoo-integration` · service: `systemctl {status,restart} odoo-dashboard` · log: `journalctl -u odoo-dashboard -f`
- Apache proxy: `/etc/httpd/conf.d/intranet.cititex.co.th.conf` (แก้แล้วต้อง `apachectl configtest` ก่อน `systemctl reload httpd` — เครื่องนี้เป็น intranet production มีระบบอื่นอยู่)
- Credentials อยู่ใน `/Odoo/odoo-integration/.env.local` (chmod 600, ไม่อยู่ใน git)

### อัปเดตเวอร์ชันใหม่

```bash
ssh root@192.168.101.104
cd /Odoo/odoo-integration && git pull origin master
npm install --production        # เฉพาะเมื่อ dependencies เปลี่ยน
systemctl restart odoo-dashboard
curl -s -H 'Host: 192.168.101.104' http://127.0.0.1/Odoo/api/odoo/business-units | head -c 200
```

## รันบนเครื่อง dev

```bash
npm install
cp .env.example .env.local   # ใส่รหัสผ่านจริง
PORT=3105 node server.js     # เปิด http://localhost:3105
```

`node test.js` = ทดสอบการต่อ DB · `queries-validated.sql` = query หลักทั้งหมดที่ตรวจกับข้อมูลจริงแล้ว

## หมายเหตุ

- หน้าเว็บ refresh อัตโนมัติทุก 60 วินาที + server cache 60 วินาที → ข้อมูลหน่วงสูงสุด ~2 นาที
- ไม่มีระบบ login — เข้าถึงได้ทั้ง LAN (ถ้าต้องการจำกัดสิทธิ์ให้เพิ่ม Basic Auth ที่ Apache หรือ token ใน Express)
- helper `odoo_connection.py` / `odoo-connection.php` เป็นตัวอย่างต่อ DB ภาษาอื่น ไม่ได้ใช้ใน production
