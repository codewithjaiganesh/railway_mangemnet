require("dotenv").config({ path: require("path").join(__dirname, ".env") });
const bcrypt = require("bcryptjs");
const pool = require("./db");

async function createAdmin() {
  const name = (process.env.ADMIN_NAME || "RailFlow Administrator").trim();
  const email = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || "";
  if (!email || !password || password.length < 12) {
    console.error("Set ADMIN_EMAIL and ADMIN_PASSWORD (at least 12 characters) in backend/.env first.");
    process.exitCode = 1;
    await pool.end();
    return;
  }

  try {
    const hash = await bcrypt.hash(password, 12);
    await pool.query(
      `INSERT INTO users (full_name, email, password_hash, account_role)
       VALUES (?, ?, ?, 'admin')
       ON DUPLICATE KEY UPDATE full_name = ?, password_hash = ?, account_role = 'admin'`,
      [name, email, hash, name, hash]
    );
    console.log(`Admin account is ready for ${email}. Password was not printed.`);
  } catch (error) {
    console.error("Admin creation failed:", error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

createAdmin();
