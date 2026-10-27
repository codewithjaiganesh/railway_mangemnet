require("dotenv").config({ path: require("path").join(__dirname, ".env") });
const fs = require("fs");
const path = require("path");
const pool = require("./db");

async function columnExists(table, column) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS total FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return Number(rows[0].total) > 0;
}

async function ensureColumn(table, column, definition) {
  if (!(await columnExists(table, column))) {
    await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
    console.log(`Added missing column ${table}.${column}`);
  }
}

async function runSchema() {
  try {
    const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
    const statements = schema.split(";").map((sql) => sql.trim()).filter(Boolean);
    for (const sql of statements) {
      if (sql.startsWith("--") && !sql.includes("CREATE TABLE")) {
        // Keep comments with their following SQL; MySQL accepts leading comments.
      }
      await pool.query(sql);
      const createMatch = sql.match(/CREATE TABLE IF NOT EXISTS\s+(\w+)/i);
      if (createMatch) console.log(`Checked table: ${createMatch[1]}`);
    }

    await ensureColumn("users", "account_role", "ENUM('passenger','admin') NOT NULL DEFAULT 'passenger'");
    await ensureColumn("bookings", "travel_class", "VARCHAR(50) NOT NULL DEFAULT 'Sleeper'");
    console.log("RailFlow schema is ready. Existing records were not dropped.");
  } catch (error) {
    console.error("Schema setup failed:", error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

runSchema();
