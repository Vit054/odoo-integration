// เก็บรายชื่อตารางที่อนุญาตให้ INSERT (writable-tables.json — ไม่อยู่ใน git)
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'writable-tables.json');
let cache = null;

function load() {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (!Array.isArray(cache.tables)) cache = { tables: [] };
  } catch (e) {
    cache = { tables: [] };
  }
  return cache;
}

module.exports = {
  get() {
    return load().tables;
  },
  set(tables) {
    cache = { tables: Array.from(new Set(tables)).sort() };
    fs.writeFileSync(FILE, JSON.stringify(cache, null, 2));
    return cache.tables;
  },
};
