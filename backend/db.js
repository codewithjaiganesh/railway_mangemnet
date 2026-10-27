require("dotenv").config({ path: require("path").join(__dirname, ".env") });

const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

let ssl;
if (process.env.DB_CA_CERT_PATH) {
  const caPath = path.isAbsolute(process.env.DB_CA_CERT_PATH)
    ? process.env.DB_CA_CERT_PATH
    : path.join(__dirname, process.env.DB_CA_CERT_PATH);
  ssl = { ca: fs.readFileSync(caPath, "utf8"), rejectUnauthorized: true };
} else {
  // Development/demo fallback only. For production, configure DB_CA_CERT_PATH
  // with Aiven's CA certificate so the server certificate can be verified.
  ssl = { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED === "true" };
}

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || "defaultdb",
  ssl,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  dateStrings: true,
  decimalNumbers: true
});

module.exports = pool;
