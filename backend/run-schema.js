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
      await pool.query(sql);
      const createMatch = sql.match(/CREATE TABLE IF NOT EXISTS\s+(\w+)/i);
      if (createMatch) console.log(`Checked table: ${createMatch[1]}`);
    }

    // Non-destructive upgrades for databases created with earlier RailFlow versions.
    const columns = [
      ["users", "account_role", "ENUM('passenger','admin') NOT NULL DEFAULT 'passenger'"],
      ["users", "date_of_birth", "DATE NULL"],
      ["users", "gender", "VARCHAR(20) NULL"],
      ["users", "phone_no", "VARCHAR(20) NULL"],
      ["users", "address", "VARCHAR(250) NULL"],
      ["stations", "state", "VARCHAR(100) NULL"],
      ["trains", "source", "VARCHAR(120) NULL"],
      ["trains", "destination", "VARCHAR(120) NULL"],
      ["trains", "capacity", "INT NOT NULL DEFAULT 0"],
      ["trains", "status", "VARCHAR(20) NOT NULL DEFAULT 'Active'"],
      ["bookings", "travel_class", "VARCHAR(50) NOT NULL DEFAULT 'Sleeper'"],
      ["bookings", "seat_no", "VARCHAR(100) NULL"],
      ["bookings", "coach_no", "VARCHAR(20) NULL"]
    ];
    for (const [table, column, definition] of columns) await ensureColumn(table, column, definition);

    // Backfill the normalized TRAIN_SCHEDULE stop entity from routes already stored.
    await pool.query(
      `INSERT IGNORE INTO train_schedule
       (schedule_id, train_id, station_id, arrival_time, departure_time, platform_no, stop_number)
       SELECT s.id, s.train_id, r.source_station_id, NULL, s.departure_time, NULL, 1
       FROM schedules s JOIN schedule_routes r ON r.schedule_id = s.id`
    );
    await pool.query(
      `INSERT IGNORE INTO train_schedule
       (schedule_id, train_id, station_id, arrival_time, departure_time, platform_no, stop_number)
       SELECT s.id, s.train_id, r.destination_station_id, s.arrival_time, NULL, NULL, 2
       FROM schedules s JOIN schedule_routes r ON r.schedule_id = s.id`
    );

    // Give older bookings a payment row so the Payments module can report the full history.
    await pool.query(
      `INSERT IGNORE INTO payments (booking_id, amount, payment_method, payment_status, transaction_ref)
       SELECT b.id, b.total_fare, 'Pending', 'PENDING', CONCAT('RFPM-LEGACY-', b.id)
       FROM bookings b`
    );

    console.log("RailFlow schema is ready. Existing records were preserved; payment and stop records were backfilled.");
  } catch (error) {
    console.error("Schema setup failed:", error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

runSchema();
