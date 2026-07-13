# CFF Odoo API Guide (ฉบับภายใน — ครบทุก endpoint)

> ⚠️ เอกสารนี้เป็น**ฉบับภายใน** มีข้อมูล endpoint ของ dashboard/config ที่ไม่ควรแจกคนภายนอก
> ถ้าจะส่งให้ทีมภายนอกที่มาต่อ integration ให้ใช้ชุดเอกสารใน `public/` แทน:
> หน้าเว็บ `api-guide.html` · PDF `CFF-Odoo-API-Guide.pdf` · OpenAPI `openapi.yaml` · Postman `CFF-Odoo-API.postman_collection.json`

คู่มือสำหรับนักพัฒนา/ทีมอื่นที่ต้องการดึงข้อมูลจากระบบ Odoo 14 ของ CITY FRESH FRUIT
ผ่าน REST API ของ Odoo Dashboard (ไม่ต้องต่อ database ตรง ไม่ต้องมี user Odoo)

> **เวอร์ชันเอกสาร:** กรกฎาคม 2026 · สอดคล้องกับ server v2.0.0

---

## 1. ภาพรวม

```
แอปของคุณ (ใน LAN) ──HTTP──> http://192.168.101.104/Odoo/api/odoo/*
                                    │ Express (อ่านอย่างเดียว + Write API แบบ allowlist)
                                    ▼
                              PostgreSQL ของ Odoo 14 (DB: odoo_cff_golive)
```

- **Base URL:** `http://192.168.101.104/Odoo` — เข้าถึงได้เฉพาะในวง LAN บริษัทเท่านั้น
- API เป็น **read-only เป็นหลัก** — ดึงข้อมูลได้อิสระ, การเขียน (INSERT) ถูกปิดทุกตารางโดยค่าเริ่มต้น
- ข้อมูลอ่านตรงจาก database จริงของ Odoo → เห็นข้อมูลเดียวกับใน Odoo เสมอ (มี cache สูงสุด 60 วินาทีเฉพาะบาง endpoint)
- ทุก response เป็น JSON รูปแบบเดียวกัน:

```json
// สำเร็จ
{ "success": true, "data": ..., "count": 123 }

// ผิดพลาด
{ "success": false, "error": "คำอธิบายข้อผิดพลาด" }
```

### การขอสิทธิ์ใช้งาน

| ต้องการ | ต้องทำอะไร |
|---|---|
| อ่านข้อมูล (ทุก endpoint ในข้อ 3–4) | ไม่ต้องขอ token — แค่อยู่ใน LAN ก็เรียกได้เลย |
| เขียนข้อมูล (INSERT) | ติดต่อผู้ดูแลระบบเพื่อ (1) รับ `ADMIN_TOKEN` และ (2) ให้เปิดตารางที่ต้องการในหน้า `/config` |

---

## 2. เริ่มต้นเร็วที่สุด (Quick Start)

```bash
# 1) เช็คว่า server ออนไลน์
curl http://192.168.101.104/Odoo/health
# → {"status":"ok","message":"Odoo dashboard server is running"}

# 2) ดูยอดขายแยก Business Unit ปีนี้
curl "http://192.168.101.104/Odoo/api/odoo/business-units"

# 3) ดึงข้อมูล dashboard ทั้งหน้า (เดือนนี้ ทุก BU)
curl "http://192.168.101.104/Odoo/api/odoo/dashboard?bu=all&period=month"
```

---

## 3. Read Endpoints (ไม่ต้องใช้ token)

### 3.1 `GET /health` — Health check

ตรวจว่า server ทำงานอยู่ ใช้ทำ monitoring ได้

### 3.2 `GET /api` — รายการ endpoint ทั้งหมด

คืน JSON สรุป endpoint (self-documenting)

### 3.3 `GET /api/odoo/dashboard` — ข้อมูล dashboard ผู้บริหารทั้งชุด

Endpoint หลักที่รวม KPI ยอดขาย, ตารางแยก BU, เทรนด์ 14 วัน, สินค้าขายดี, เอกสารล่าสุด และแจ้งเตือน ในคำขอเดียว

**Query parameters**

| พารามิเตอร์ | ค่า | ค่าเริ่มต้น | ความหมาย |
|---|---|---|---|
| `bu` | `all` หรือชื่อ BU เช่น `Horeca` | `all` | กรองตาม Business Unit (ต้องสะกดตรงกับชื่อใน Odoo — ดูรายชื่อจาก `/business-units`) |
| `period` | `today` \| `month` \| `year` | `month` | ช่วงเวลาของ KPI/ตาราง BU/สินค้าขายดี |

**ตัวอย่าง**

```bash
curl "http://192.168.101.104/Odoo/api/odoo/dashboard?bu=Horeca&period=today"
```

**โครงสร้าง response (`data`)**

```jsonc
{
  "generatedAt": "2026-07-13T04:00:00.000Z",
  "bu": "all",              // BU ที่กรอง
  "period": "month",
  "metrics": {
    "invoice": 12345678.9,   // ยอดใบแจ้งหนี้ (ก่อน VAT)
    "cn": 23456.7,           // ยอดลดหนี้ (Credit Note)
    "net": 12322222.2,       // สุทธิ = invoice - cn
    "invoiceCount": 321,     // จำนวนใบแจ้งหนี้
    "cnCount": 5,            // จำนวนใบลดหนี้
    "inventoryValue": 9876543.2, // มูลค่าสต๊อกทั้งบริษัท (ตามบัญชี)
    "posToday": 45678.0,     // ยอด POS วันนี้ (แยกช่องทาง ไม่รวมใน invoice)
    "posOrdersToday": 87,
    "draftInvoices": 3       // ใบแจ้งหนี้ค้าง Draft (ยังไม่นับเป็นยอดขาย)
  },
  "buBreakdown": [           // ตารางแยกตาม BU (ทุก BU ในช่วงเวลาที่เลือก)
    { "bu": "Modern Trade (ห้าง)", "invoice": 0, "cn": 0, "net": 0,
      "invoice_count": 0, "cn_count": 0 }
  ],
  "charts": {
    "trend": [               // ยอดรายวันย้อนหลัง 14 วัน
      { "date": "2026-07-01", "invoice": 0, "cn": 0, "net": 0 }
    ]
  },
  "topProducts": [           // สินค้าขายดี 8 อันดับ (ตามยอดสุทธิ)
    { "name": "…", "qty": 0, "revenue": 0 }
  ],
  "recentDocs": [            // เอกสาร 10 ใบล่าสุด
    { "id": "INV/2026/0001", "customer": "…", "amount": 0,
      "type": "out_invoice", "date": "13/07/2026", "bu": "Horeca" }
  ],
  "lowStock": [              // สินค้าต่ำกว่าจุดสั่งซื้อ (ทั้งบริษัท)
    { "name": "…", "on_hand": 2, "min_qty": 10 }
  ],
  "alerts": [                // แจ้งเตือนอัตโนมัติ (สต๊อกใกล้หมด / CN / Draft ค้าง)
    { "id": "low-stock", "type": "warning", "title": "…", "message": "…" }
  ]
}
```

### 3.4 `GET /api/odoo/business-units` — รายชื่อ Business Unit

คืนรายชื่อ BU ที่มียอดขายปีนี้ พร้อมยอดสุทธิและจำนวนเอกสาร — ใช้หาค่า `bu` ที่ถูกต้องสำหรับ endpoint อื่น

```json
{ "success": true, "data": [
  { "name": "Modern Trade (ห้าง)", "net": 12345678.9, "docs": 456 }
]}
```

BU ที่มีในระบบ: Modern Trade (ห้าง), Traditional trade (ยี่ปั๊ว), Horeca, CLMV, Consignment, Direct sales, Retail store, Center

### 3.5 `GET /api/odoo/tables` — รายชื่อตารางทั้งหมดใน database

ใช้สำรวจ schema (สำหรับ dev) — คืน `[{ "table_name": "account_move" }, ...]`

### 3.6 `GET /api/odoo/schema/:tableName` — โครงสร้างตาราง

```bash
curl http://192.168.101.104/Odoo/api/odoo/schema/account_move
```

คืน `[{ "column_name": "id", "data_type": "integer", "is_nullable": "NO" }, ...]`

### 3.7 `POST /api/odoo/query` — SQL query อ่านอย่างเดียว ⭐

Endpoint ที่ยืดหยุ่นที่สุด — ส่ง SQL ของคุณเองได้ (SELECT เท่านั้น)

**กติกา**
- อนุญาตเฉพาะคำสั่งที่ขึ้นต้นด้วย `SELECT` หรือ `WITH` **คำสั่งเดียว** (ห้ามมี `;` คั่นหลายคำสั่ง) — อย่างอื่นถูกปฏิเสธด้วย `403`
- ไม่มี cache — ยิงตรงเข้า database จริงทุกครั้ง → **ใส่ `LIMIT` เสมอ** และหลีกเลี่ยง query หนัก ๆ ถี่ ๆ (เป็น database ที่ Odoo production ใช้อยู่)
- Timestamp ใน database เก็บเป็น **UTC** — แปลงเป็นเวลาไทยด้วย `AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Bangkok'` (ยกเว้นคอลัมน์ประเภท DATE เช่น `invoice_date` ใช้ตรง ๆ ได้)

**ตัวอย่าง**

```bash
curl -X POST http://192.168.101.104/Odoo/api/odoo/query \
  -H "Content-Type: application/json" \
  -d '{"sql": "SELECT name, email FROM res_partner WHERE customer_rank > 0 ORDER BY id DESC LIMIT 20"}'
```

```json
{ "success": true, "data": [ { "name": "…", "email": "…" } ], "count": 20 }
```

---

## 4. สูตรตัวเลขยอดขาย (สำคัญ — อ่านก่อนเขียน query เอง)

ตัวเลข "ยอดขาย" ของบริษัทมีนิยามตายตัว ถ้า query เองต้องใช้เงื่อนไขชุดนี้ ไม่งั้นตัวเลขจะไม่ตรงกับ dashboard/ฝ่ายบัญชี:

| เรื่อง | นิยาม |
|---|---|
| เอกสารที่นับ | `account_move` ที่ `move_type IN ('out_invoice','out_refund')` และ `state = 'posted'` เท่านั้น (Draft ไม่นับ) |
| จำนวนเงิน | `-aml.balance` จาก `account_move_line` = ยอด**ก่อน VAT ในสกุลเงินบริษัท** (invoice เป็นบวก, CN เป็นลบ — รองรับใบ USD อัตโนมัติ) |
| กรองบรรทัด | `aml.exclude_from_invoice_tab = false AND aml.display_type IS NULL` (เอาเฉพาะบรรทัดสินค้า ตัดบรรทัดภาษี/หมายเหตุ) |
| Business Unit | custom field `account_move_line.business_unit_id` → ตาราง `cu_business_unit` (ชื่อ BU ซ้ำกันได้หลาย id — ต้อง `GROUP BY bu.name`) |
| "วันนี้" | `(now() AT TIME ZONE 'Asia/Bangkok')::date` เทียบกับ `invoice_date` |

**Query แม่แบบ** (ยอดสุทธิแยก BU เดือนนี้ — ตรวจกับข้อมูลจริงแล้ว):

```sql
SELECT COALESCE(bu.name, '(ไม่ระบุ BU)') AS business_unit,
       SUM(-aml.balance) AS net
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
ORDER BY net DESC
```

ดู query ที่ผ่านการตรวจสอบแล้วทั้งหมดได้ใน [queries-validated.sql](queries-validated.sql)

**ตารางหลักของ Odoo 14 ที่ใช้บ่อย**

| ตาราง | เก็บอะไร |
|---|---|
| `account_move` / `account_move_line` | ใบแจ้งหนี้ ใบลดหนี้ และรายการบัญชี |
| `res_partner` | ลูกค้า / ผู้ขาย / ผู้ติดต่อ |
| `product_product` + `product_template` | สินค้า (join ผ่าน `product_tmpl_id`) |
| `sale_order` / `sale_order_line` | ใบสั่งขาย |
| `stock_quant` | สต๊อกคงเหลือรายตำแหน่ง (`location_id` → `stock_location.usage='internal'` = ในคลัง) |
| `stock_valuation_layer` | มูลค่าสต๊อกทางบัญชี (`SUM(remaining_value)`) |
| `pos_order` | บิลขายหน้าร้าน (POS) |
| `cu_business_unit` | Business Unit (ตาราง custom ของ CFF) |

---

## 5. Write API — INSERT (ต้องใช้ token)

> ⚠️ **คำเตือนสำคัญ:** การ INSERT ตรงเข้า database จะ**ข้าม business logic ของ Odoo ทั้งหมด**
> (เลขรันเอกสาร, ฟิลด์คำนวณ, การตัดสต๊อก, workflow) — ใช้ได้กับ**ตาราง custom หรือตารางข้อมูลง่าย ๆ เท่านั้น**
> ห้ามใช้เขียน `sale_order`, `account_move`, `stock_move` และตารางเอกสารหลักของ Odoo เด็ดขาด

### การยืนยันตัวตน

ทุกคำขอเขียนต้องแนบ token อย่างใดอย่างหนึ่ง:

```
Authorization: Bearer <ADMIN_TOKEN>     ← แนะนำ
x-api-key: <ADMIN_TOKEN>                ← ทางเลือก
```

ขอ token ได้จากผู้ดูแลระบบ และตารางที่จะเขียนต้อง**ถูกเปิดใน allowlist ก่อน** (หน้า `/config` หรือ endpoint 5.3)

### 5.1 `POST /api/odoo/insert/:table` — เพิ่มข้อมูล

- Body: `{ "data": {…} }` (แถวเดียว) หรือ `{ "data": [{…}, …] }` (หลายแถว **สูงสุด 500**)
- หลายแถวรันใน **transaction เดียว** — แถวไหนพัง rollback ทั้งหมด
- ชื่อคอลัมน์ถูกตรวจกับ schema จริงก่อนเสมอ — คอลัมน์ที่ไม่มีในตารางจะได้ `400` พร้อมบอกว่าคอลัมน์ไหนผิด
- เติม `?dryRun=1` เพื่อดู SQL ที่จะรันโดย**ไม่ execute จริง** — ใช้ทดสอบก่อนยิงจริงเสมอ

```bash
# ทดสอบก่อน (ไม่เขียนจริง)
curl -X POST "http://192.168.101.104/Odoo/api/odoo/insert/my_custom_table?dryRun=1" \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"data": {"name": "ทดสอบ", "qty": 5}}'

# ยิงจริง
curl -X POST http://192.168.101.104/Odoo/api/odoo/insert/my_custom_table \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"data": [{"name": "A", "qty": 1}, {"name": "B", "qty": 2}]}'
```

**Response สำเร็จ** — คืนแถวที่ insert แล้วทั้งหมด (รวมค่า default เช่น `id`):

```json
{ "success": true, "count": 2, "data": [ { "id": 101, "name": "A", "qty": 1 }, … ] }
```

### 5.2 `GET /api/odoo/config/writable-tables` — ดูตารางที่เปิดเขียนอยู่ (ต้องใช้ token)

### 5.3 `PUT /api/odoo/config/writable-tables` — ตั้ง allowlist (ต้องใช้ token)

```bash
curl -X PUT http://192.168.101.104/Odoo/api/odoo/config/writable-tables \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"tables": ["my_custom_table"]}'
```

> ปกติผู้ดูแลระบบเป็นคนจัดการ allowlist ผ่านหน้า `/config` — ทีมภายนอกไม่ควรแก้เอง

---

## 6. Error Codes

| HTTP | ความหมาย | เจอเมื่อ |
|---|---|---|
| `400` | คำขอผิดรูปแบบ | ไม่ส่ง `sql`, คอลัมน์ไม่มีในตาราง, data เกิน 500 แถว, insert แล้ว constraint พัง |
| `401` | token ผิดหรือไม่ได้ส่ง | Write API ทุกตัว |
| `403` | ไม่อนุญาต | query ที่ไม่ใช่ SELECT/WITH, ตารางยังไม่เปิดใน allowlist |
| `404` | ไม่พบ | ตารางไม่มีใน database |
| `503` | Write API ปิดอยู่ | server ยังไม่ได้ตั้ง `ADMIN_TOKEN` |
| `500` | ข้อผิดพลาดฝั่ง server / database | ดูข้อความใน `error` |

ทุก error มี body: `{ "success": false, "error": "…" }`

---

## 7. ตัวอย่างโค้ดภาษาต่าง ๆ

### JavaScript (fetch)

```js
const BASE = 'http://192.168.101.104/Odoo';

// อ่าน dashboard
const res = await fetch(`${BASE}/api/odoo/dashboard?bu=all&period=month`);
const { success, data, error } = await res.json();
if (!success) throw new Error(error);
console.log('ยอดสุทธิเดือนนี้:', data.metrics.net);

// SQL query
const q = await fetch(`${BASE}/api/odoo/query`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ sql: 'SELECT name FROM res_partner LIMIT 5' }),
}).then(r => r.json());
```

### Python (requests)

```python
import requests

BASE = 'http://192.168.101.104/Odoo'

# อ่าน dashboard
r = requests.get(f'{BASE}/api/odoo/dashboard', params={'bu': 'all', 'period': 'month'})
body = r.json()
assert body['success'], body.get('error')
print('ยอดสุทธิเดือนนี้:', body['data']['metrics']['net'])

# SQL query
r = requests.post(f'{BASE}/api/odoo/query',
                  json={'sql': 'SELECT name FROM res_partner LIMIT 5'})
print(r.json())

# INSERT (ต้องมี token + ตารางถูกเปิดแล้ว)
r = requests.post(f'{BASE}/api/odoo/insert/my_custom_table',
                  headers={'Authorization': 'Bearer <token>'},
                  json={'data': {'name': 'ทดสอบ', 'qty': 5}})
```

### PHP (cURL)

```php
$base = 'http://192.168.101.104/Odoo';

$ch = curl_init("$base/api/odoo/query");
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST => true,
    CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
    CURLOPT_POSTFIELDS => json_encode(['sql' => 'SELECT name FROM res_partner LIMIT 5']),
]);
$body = json_decode(curl_exec($ch), true);
curl_close($ch);
if (!$body['success']) { die($body['error']); }
print_r($body['data']);
```

### Excel / Power BI (Power Query)

`Data → Get Data → From Web` แล้วใส่ URL เช่น
`http://192.168.101.104/Odoo/api/odoo/business-units`
จากนั้นใน Power Query ขยายฟิลด์ `data` เป็นตาราง — ตั้ง refresh ตามต้องการ

---

## 8. ข้อควรปฏิบัติ (Fair Use)

1. **ใส่ `LIMIT` ทุก query** ที่ยิงผ่าน `/query` — database ตัวนี้คือตัวเดียวกับที่ Odoo production ใช้งานอยู่
2. **อย่า poll ถี่กว่า 60 วินาที** — `dashboard` และ `business-units` มี cache 60 วินาทีอยู่แล้ว ยิงถี่กว่านั้นได้ข้อมูลเดิม
3. **อย่า SELECT \* จากตารางใหญ่** (`account_move_line`, `stock_move_line` มีหลายล้านแถว) — เลือกคอลัมน์และกรองช่วงเวลาเสมอ
4. **การเขียนข้อมูล** ให้ทดสอบด้วย `?dryRun=1` ก่อนทุกครั้ง และใช้กับตาราง custom เท่านั้น
5. ระบบ**ไม่มี login สำหรับฝั่งอ่าน** — อย่านำข้อมูลที่ได้ไปเผยแพร่นอกบริษัท
6. ถ้าต้องการ endpoint เฉพาะทาง (เช่น รายงานที่ query ซับซ้อน) ติดต่อผู้ดูแลระบบให้เพิ่มเป็น endpoint ที่มี cache ดีกว่ายิง `/query` เองซ้ำ ๆ

---

## 9. ติดต่อ / แจ้งปัญหา

- ผู้ดูแลระบบ: ฝ่าย IT/EDP — ขอ token, เปิดตาราง INSERT, ขอ endpoint ใหม่
- ตรวจสถานะ server: `GET /health` — ถ้าไม่ตอบให้แจ้งผู้ดูแลระบบ (service: `odoo-dashboard` บน 192.168.101.104)
- โค้ดต้นทาง: โฟลเดอร์ `App Odoo` (README.md อธิบายสถาปัตยกรรมและการ deploy)
