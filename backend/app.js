require("dotenv").config({ path: require("path").join(__dirname, ".env") });

const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("./db");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || "railflow-local-demo-secret-change-before-deployment";
if (!process.env.JWT_SECRET) {
  if (process.env.NODE_ENV === "production") throw new Error("JWT_SECRET must be set in production.");
  console.warn("WARNING: Using the local demo JWT secret. Add a private JWT_SECRET to backend/.env before deploying.");
}

app.use(cors({ origin: true }));
app.use(express.json({ limit: "100kb" }));

const bookingSelect = `
  SELECT b.id, b.booking_reference, b.user_id, u.full_name, u.email,
         t.train_number, t.train_name, t.train_type, s.id AS schedule_id,
         s.journey_date, s.departure_time, s.arrival_time,
         src.station_code AS source_code, src.station_name AS source_station,
         dst.station_code AS destination_code, dst.station_name AS destination_station,
         b.seats_booked, b.travel_class, b.total_fare, b.booking_status, b.created_at
  FROM bookings b
  JOIN users u ON u.id = b.user_id
  JOIN schedules s ON s.id = b.schedule_id
  JOIN trains t ON t.id = s.train_id
  LEFT JOIN schedule_routes r ON r.schedule_id = s.id
  LEFT JOIN stations src ON src.id = r.source_station_id
  LEFT JOIN stations dst ON dst.id = r.destination_station_id`;

function createToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, full_name: user.full_name, role: user.role },
    JWT_SECRET,
    { expiresIn: "8h", issuer: "railflow" }
  );
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return res.status(401).json({ error: "Please sign in to continue." });
  try {
    req.user = jwt.verify(token, JWT_SECRET, { issuer: "railflow" });
    next();
  } catch {
    return res.status(401).json({ error: "Your session is invalid or expired. Please sign in again." });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") return res.status(403).json({ error: "Administrator access is required." });
  next();
}

function validDate(date) {
  return typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(`${date}T00:00:00Z`));
}

app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ message: "RailFlow backend is running!", database: "connected" });
  } catch (error) {
    console.error("Health check database error:", error.message);
    res.status(503).json({ message: "Backend is running, but the database is unavailable.", database: "disconnected" });
  }
});

app.get("/api/stations", async (_req, res) => {
  try {
    const [rows] = await pool.query("SELECT id, station_code, station_name, city FROM stations ORDER BY station_name");
    res.json(rows);
  } catch (error) {
    console.error("Station query failed:", error.message);
    res.status(500).json({ error: "Could not load stations. Run the database setup first." });
  }
});

// Public schedule search. Only demo timetable data seeded in this project is returned.
app.get("/api/trains/search", async (req, res) => {
  const from = String(req.query.from || "").trim().toUpperCase();
  const to = String(req.query.to || "").trim().toUpperCase();
  const date = String(req.query.date || "").trim();
  if (!/^[A-Z0-9]{2,10}$/.test(from) || !/^[A-Z0-9]{2,10}$/.test(to) || from === to || !validDate(date)) {
    return res.status(400).json({ error: "Provide different source and destination station codes and a valid journey date." });
  }

  try {
    const [rows] = await pool.query(
      `SELECT s.id AS schedule_id, t.id AS train_id, t.train_number, t.train_name,
              t.train_type, src.station_code AS source_code, src.station_name AS source_station,
              dst.station_code AS destination_code, dst.station_name AS destination_station,
              s.journey_date, s.departure_time, s.arrival_time,
              s.available_seats, s.fare
       FROM schedules s
       JOIN trains t ON t.id = s.train_id
       JOIN schedule_routes r ON r.schedule_id = s.id
       JOIN stations src ON src.id = r.source_station_id
       JOIN stations dst ON dst.id = r.destination_station_id
       WHERE src.station_code = ? AND dst.station_code = ?
         AND s.journey_date = ? AND s.available_seats > 0
       ORDER BY s.departure_time`,
      [from, to, date]
    );
    res.json(rows);
  } catch (error) {
    console.error("Train search failed:", error.message);
    res.status(500).json({ error: "Train search failed. Run node run-schema.js and node seed-data.js in the backend folder." });
  }
});

app.post("/api/auth/register", async (req, res) => {
  const fullName = String(req.body.full_name || "").trim();
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  if (fullName.length < 2 || fullName.length > 100 || !/^\S+@\S+\.\S+$/.test(email) || password.length < 8) {
    return res.status(400).json({ error: "Enter your full name, a valid email, and a password of at least 8 characters." });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const [result] = await pool.query(
      "INSERT INTO users (full_name, email, password_hash, account_role) VALUES (?, ?, ?, 'passenger')",
      [fullName, email, passwordHash]
    );
    const user = { id: result.insertId, full_name: fullName, email, role: "passenger" };
    res.status(201).json({ message: "Passenger account created.", token: createToken(user), user });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") return res.status(409).json({ error: "An account with this email already exists. Sign in instead." });
    console.error("Registration failed:", error.message);
    res.status(500).json({ error: "Could not create your account." });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const requestedRole = req.body.role === "admin" ? "admin" : "passenger";
  if (!email || !password) return res.status(400).json({ error: "Enter your email and password." });

  try {
    const [rows] = await pool.query(
      "SELECT id, full_name, email, password_hash, account_role AS role FROM users WHERE email = ? LIMIT 1",
      [email]
    );
    if (!rows.length || rows[0].role !== requestedRole || !(await bcrypt.compare(password, rows[0].password_hash))) {
      return res.status(401).json({ error: requestedRole === "admin" ? "Invalid administrator credentials." : "Invalid email or password." });
    }
    const user = { id: rows[0].id, full_name: rows[0].full_name, email: rows[0].email, role: rows[0].role };
    res.json({ message: "Signed in successfully.", token: createToken(user), user });
  } catch (error) {
    console.error("Login failed:", error.message);
    res.status(500).json({ error: "Could not sign in. Check the backend and database." });
  }
});

app.get("/api/me", requireAuth, (req, res) => {
  res.json({ user: { id: req.user.id, full_name: req.user.full_name, email: req.user.email, role: req.user.role } });
});

app.get("/api/bookings", requireAuth, async (req, res) => {
  try {
    const where = req.user.role === "admin" ? "" : " WHERE b.user_id = ?";
    const params = req.user.role === "admin" ? [] : [req.user.id];
    const [rows] = await pool.query(`${bookingSelect}${where} ORDER BY b.created_at DESC`, params);
    res.json(rows);
  } catch (error) {
    console.error("Booking query failed:", error.message);
    res.status(500).json({ error: "Could not load bookings." });
  }
});

app.post("/api/bookings", requireAuth, async (req, res) => {
  if (req.user.role !== "passenger") return res.status(403).json({ error: "Sign in as a passenger to create a booking." });
  const scheduleId = Number(req.body.schedule_id);
  const seats = Number(req.body.seats_booked);
  const allowedClasses = new Set(["AC First Class", "AC 2 Tier", "AC 3 Tier", "Sleeper", "Chair Car"]);
  const travelClass = allowedClasses.has(req.body.travel_class) ? req.body.travel_class : "Sleeper";
  if (!Number.isInteger(scheduleId) || scheduleId < 1 || !Number.isInteger(seats) || seats < 1 || seats > 6) {
    return res.status(400).json({ error: "Choose a valid schedule and between 1 and 6 seats." });
  }

  let connection;
  let transactionStarted = false;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    transactionStarted = true;
    const [schedules] = await connection.query(
      `SELECT s.id, s.available_seats, s.fare, s.journey_date
       FROM schedules s WHERE s.id = ? AND s.journey_date >= CURDATE() FOR UPDATE`,
      [scheduleId]
    );
    if (!schedules.length) {
      await connection.rollback();
      transactionStarted = false;
      return res.status(404).json({ error: "That schedule is not available for booking." });
    }
    if (Number(schedules[0].available_seats) < seats) {
      await connection.rollback();
      transactionStarted = false;
      return res.status(409).json({ error: `Only ${schedules[0].available_seats} seats are available.` });
    }

    const reference = `RF-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const totalFare = Number(schedules[0].fare) * seats;
    const [result] = await connection.query(
      `INSERT INTO bookings (booking_reference, user_id, schedule_id, seats_booked, travel_class, total_fare, booking_status)
       VALUES (?, ?, ?, ?, ?, ?, 'CONFIRMED')`,
      [reference, req.user.id, scheduleId, seats, travelClass, totalFare]
    );
    await connection.query(
      "UPDATE schedules SET available_seats = available_seats - ? WHERE id = ?",
      [seats, scheduleId]
    );
    await connection.commit();
    transactionStarted = false;
    res.status(201).json({
      message: "Booking saved to the RailFlow database.",
      booking_id: result.insertId,
      booking_reference: reference,
      schedule_id: scheduleId,
      seats_booked: seats,
      total_fare: totalFare,
      booking_status: "CONFIRMED"
    });
  } catch (error) {
    if (connection && transactionStarted) {
      try { await connection.rollback(); } catch { /* transaction may already have ended */ }
    }
    console.error("Booking creation failed:", error.message);
    res.status(500).json({ error: "Could not save the booking. Check that the database schema and seed data are set up." });
  } finally {
    if (connection) connection.release();
  }
});

app.get("/api/admin/dashboard", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const queries = await Promise.all([
      pool.query("SELECT COUNT(*) AS total FROM trains"),
      pool.query("SELECT COUNT(*) AS total FROM schedules WHERE journey_date >= CURDATE()"),
      pool.query("SELECT COUNT(*) AS total FROM bookings"),
      pool.query("SELECT COUNT(*) AS total FROM users WHERE account_role = 'passenger'"),
      pool.query("SELECT COALESCE(SUM(total_fare),0) AS total FROM bookings WHERE booking_status = 'CONFIRMED'")
    ]);
    const [recentBookings] = await pool.query(`${bookingSelect} ORDER BY b.created_at DESC LIMIT 12`);
    res.json({
      metrics: {
        trains: Number(queries[0][0][0].total),
        schedules: Number(queries[1][0][0].total),
        bookings: Number(queries[2][0][0].total),
        passengers: Number(queries[3][0][0].total),
        confirmed_fare_total: Number(queries[4][0][0].total)
      },
      recentBookings
    });
  } catch (error) {
    console.error("Admin dashboard failed:", error.message);
    res.status(500).json({ error: "Could not load admin dashboard data." });
  }
});

app.get("/api/admin/trains", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT t.id, t.train_number, t.train_name, t.train_type,
              COUNT(s.id) AS schedule_count
       FROM trains t LEFT JOIN schedules s ON s.train_id = t.id
       GROUP BY t.id, t.train_number, t.train_name, t.train_type
       ORDER BY t.train_number`
    );
    res.json(rows);
  } catch (error) { console.error(error.message); res.status(500).json({ error: "Could not load trains." }); }
});

app.get("/api/admin/schedules", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT s.id AS schedule_id, t.train_number, t.train_name, t.train_type,
              src.station_code AS source_code, src.station_name AS source_station,
              dst.station_code AS destination_code, dst.station_name AS destination_station,
              s.journey_date, s.departure_time, s.arrival_time, s.available_seats, s.fare
       FROM schedules s JOIN trains t ON t.id = s.train_id
       LEFT JOIN schedule_routes r ON r.schedule_id = s.id
       LEFT JOIN stations src ON src.id = r.source_station_id
       LEFT JOIN stations dst ON dst.id = r.destination_station_id
       ORDER BY s.journey_date DESC, s.departure_time`
    );
    res.json(rows);
  } catch (error) { console.error(error.message); res.status(500).json({ error: "Could not load schedules." }); }
});

app.get("/api/admin/bookings", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const [rows] = await pool.query(`${bookingSelect} ORDER BY b.created_at DESC`);
    res.json(rows);
  } catch (error) { console.error(error.message); res.status(500).json({ error: "Could not load bookings." }); }
});

app.get("/api/admin/passengers", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT u.id, u.full_name, u.email, u.account_role AS role, u.created_at,
              COUNT(b.id) AS booking_count
       FROM users u LEFT JOIN bookings b ON b.user_id = u.id
       WHERE u.account_role = 'passenger'
       GROUP BY u.id, u.full_name, u.email, u.account_role, u.created_at
       ORDER BY u.created_at DESC`
    );
    res.json(rows);
  } catch (error) { console.error(error.message); res.status(500).json({ error: "Could not load passengers." }); }
});

app.get("/api/admin/stations", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT st.id, st.station_code, st.station_name, st.city,
              COUNT(DISTINCT r.schedule_id) AS schedule_count
       FROM stations st
       LEFT JOIN schedule_routes r ON st.id = r.source_station_id OR st.id = r.destination_station_id
       GROUP BY st.id, st.station_code, st.station_name, st.city
       ORDER BY st.station_name`
    );
    res.json(rows);
  } catch (error) { console.error(error.message); res.status(500).json({ error: "Could not load stations." }); }
});

app.get("/api/admin/reports", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT booking_status, COUNT(*) AS booking_count,
              COALESCE(SUM(total_fare),0) AS fare_total,
              COALESCE(SUM(seats_booked),0) AS seats_total
       FROM bookings GROUP BY booking_status ORDER BY booking_status`
    );
    res.json(rows);
  } catch (error) { console.error(error.message); res.status(500).json({ error: "Could not load reports." }); }
});

app.listen(PORT, () => {
  console.log(`RailFlow backend running on port ${PORT}`);
  console.log("Demo note: seeded schedules and fares are illustrative, not live railway data.");
});
