# Odoo Database Connection & API

Backend API connections to Odoo database with support for Node.js, Python, and PHP.

## Setup

### 1. Environment Variables
Credentials are stored in `.env.local` (not committed to git):

```bash
ODOO_DB_HOST=203.151.190.135
ODOO_DB_PORT=5432
ODOO_DB_USER=odoo
ODOO_DB_PASSWORD=oDo0c4414
ODOO_DB_NAME=odoo
```

## Node.js (Express API)

### Install Dependencies
```bash
npm install
```

### Start Server
```bash
npm start
```

Server runs on `http://localhost:3000`

### API Endpoints

**List all tables:**
```bash
GET /api/odoo/tables
```

**Get table schema:**
```bash
GET /api/odoo/schema/res_partner
```

**Fetch table data (with pagination & filters):**
```bash
GET /api/odoo/data/res_partner?limit=10&offset=0
GET /api/odoo/data/res_partner?filter={"active":true}
```

**Count records:**
```bash
GET /api/odoo/count/res_partner
```

**Execute custom query:**
```bash
POST /api/odoo/query
Content-Type: application/json

{
  "sql": "SELECT id, name FROM res_partner LIMIT 10"
}
```

## Python

### Install Dependencies
```bash
pip install -r requirements.txt
```

### Usage
```python
from odoo_connection import OdooConnection

db = OdooConnection()

# Get tables
tables = db.get_tables()
print(tables)

# Get data with pagination
data = db.get_data('res_partner', limit=10, offset=0)
print(data)

# Get table schema
schema = db.get_table_schema('res_partner')
print(schema)

# Close connection
db.close()
```

### Run Test
```bash
python odoo_connection.py
```

## PHP

### Usage
```php
<?php
require 'odoo-connection.php';

$db = new OdooConnection();

// Get tables
$tables = $db->getTables();
print_r($tables);

// Get data
$data = $db->getData('res_partner', 10, 0);
print_r($data);

// Get schema
$schema = $db->getTableSchema('res_partner');
print_r($schema);
?>
```

### Run Test
```bash
php odoo-connection.php
```

## Common Odoo Tables

- `res_partner` - Customers, Vendors, Contacts
- `sale_order` - Sales Orders
- `sale_order_line` - Sales Order Lines
- `purchase_order` - Purchase Orders
- `account_invoice` - Invoices
- `product_product` - Products
- `stock_move` - Inventory Moves
- `account_move` - Journal Entries

## Security Notes

⚠️ **Do NOT:**
- Commit `.env.local` to git
- Share credentials in code
- Allow DELETE/DROP operations via API (read-only recommended)

## Error Handling

All responses follow this format:

**Success:**
```json
{
  "success": true,
  "data": [...],
  "count": 5
}
```

**Error:**
```json
{
  "success": false,
  "error": "Error message"
}
```
