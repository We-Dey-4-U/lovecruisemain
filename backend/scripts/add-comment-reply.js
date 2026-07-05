require("dotenv").config();
const db = require("../src/config/db");

async function migrate(){
  try {
    console.log("Adding reply column...");

    await db.query(`
      ALTER TABLE post_comments
      ADD COLUMN IF NOT EXISTS parent_id UUID NULL
    `);

    console.log("DONE");
    process.exit(0);

  } catch(err){
    console.error(err);
    process.exit(1);
  }
}

migrate();