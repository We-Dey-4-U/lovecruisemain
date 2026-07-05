/**
 * Simple migration runner.
 * Applies every .sql file in /sql in filename order.
 * Usage: npm run migrate
 */
const fs = require('fs');
const path = require('path');
const db = require('./db');

console.log("🚀 MIGRATION FILE STARTED");

async function migrate() {
  const sqlDir = path.join(__dirname, '..', '..', 'sql');
  const files = fs.readdirSync(sqlDir).filter(f => f.endsWith('.sql')).sort();

  console.log(`Found ${files.length} migration file(s).`);

  for (const file of files) {
    const filePath = path.join(sqlDir, file);
    const sql = fs.readFileSync(filePath, 'utf8');
    console.log(`Applying ${file} ...`);
    try {
      await db.query(sql);
      console.log(`  ✔ ${file} applied`);
    } catch (err) {
      console.error(`  ✘ Failed applying ${file}:`, err.message);
      process.exit(1);
    }
  }

  console.log('All migrations applied successfully.');
  process.exit(0);
}

migrate();
