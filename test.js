// Test Odoo Connection
const odoo = require('./odoo-connection');

async function runTests() {
  console.log('Testing Odoo Database Connection...\n');

  // Test 1: Get tables
  console.log('1️⃣  Fetching tables...');
  const tables = await odoo.getTables();
  if (tables.success) {
    console.log(`   ✓ Found ${tables.data.length} tables`);
    console.log(`   Sample tables: ${tables.data.slice(0, 5).map(t => t.table_name).join(', ')}\n`);
  } else {
    console.log(`   ✗ Error: ${tables.error}\n`);
    await odoo.close();
    return;
  }

  // Test 2: Get res_partner schema
  console.log('2️⃣  Fetching res_partner schema...');
  const schema = await odoo.getTableSchema('res_partner');
  if (schema.success) {
    console.log(`   ✓ Got ${schema.data.length} columns`);
    schema.data.slice(0, 5).forEach(col => {
      console.log(`      - ${col.column_name}: ${col.data_type}`);
    });
    console.log();
  } else {
    console.log(`   ✗ Error: ${schema.error}\n`);
  }

  // Test 3: Get data from res_partner
  console.log('3️⃣  Fetching data from res_partner...');
  const data = await odoo.query('SELECT id, name FROM res_partner LIMIT 5');
  if (data.success) {
    console.log(`   ✓ Got ${data.count} records`);
    data.data.forEach((row, idx) => {
      console.log(`      ${idx + 1}. ${row.name || row.id}`);
    });
    console.log();
  } else {
    console.log(`   ✗ Error: ${data.error}\n`);
  }

  // Test 4: Count records
  console.log('4️⃣  Counting records in res_partner...');
  const count = await odoo.query('SELECT COUNT(*) as count FROM res_partner');
  if (count.success) {
    console.log(`   ✓ Total records: ${count.data[0].count}\n`);
  } else {
    console.log(`   ✗ Error: ${count.error}\n`);
  }

  console.log('✓ All tests completed!');
  await odoo.close();
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
