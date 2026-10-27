require("dotenv").config({ path: require("path").join(__dirname, ".env") });
const pool = require("./db");

async function testConnection() {
  try {
    const [rows] = await pool.query("SELECT DATABASE() AS database_name, 1 AS result");
    console.log("✅ Aiven MySQL connected successfully!");
    console.table(rows);
  } catch (error) {
    console.error("❌ Database connection failed:", error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

testConnection();
