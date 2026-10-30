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
         b.seats_booked, b.seat_no, b.coach_no, b.travel_class, b.total_fare, b.booking_status,
         p.payment_status, p.payment_method, p.transaction_ref, b.created_at
  FROM bookings b
  JOIN users u ON u.id = b.user_id
  JOIN schedules s ON s.id = b.schedule_id
  JOIN trains t ON t.id = s.train_id
  LEFT JOIN schedule_routes r ON r.schedule_id = s.id
  LEFT JOIN stations src ON src.id = r.source_station_id
  LEFT JOIN stations dst ON dst.id = r.destination_station_id
  LEFT JOIN payments p ON p.booking_id = b.id`;

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
         AND t.status NOT IN ('Maintenance','Inactive')
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
      `SELECT s.id, s.available_seats, s.fare, s.journey_date, t.capacity
       FROM schedules s JOIN trains t ON t.id=s.train_id
       WHERE s.id = ? AND s.journey_date >= CURDATE() AND t.status <> 'Maintenance' AND t.status <> 'Inactive' FOR UPDATE`,
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
    const [occupiedRows] = await connection.query(
      "SELECT seat_no FROM bookings WHERE schedule_id = ? AND booking_status = 'CONFIRMED' AND seat_no IS NOT NULL",
      [scheduleId]
    );
    const takenSeats = new Set(occupiedRows.flatMap((row) => String(row.seat_no || "").split(",").map((seat) => seat.trim()).filter(Boolean)));
    const coachPrefix = ({ "Sleeper": "S", "AC First Class": "H", "AC 2 Tier": "A", "AC 3 Tier": "B", "Chair Car": "C" })[travelClass] || "S";
    const maximumCoaches = Math.max(1, Math.ceil(Number(schedules[0].capacity || schedules[0].available_seats) / 72));
    const allocatedSeats = [];
    let coachNo = "";
    for (let coach = 1; coach <= maximumCoaches && allocatedSeats.length < seats; coach++) {
      for (let seat = 1; seat <= 72 && allocatedSeats.length < seats; seat++) {
        const coachLabel = `${coachPrefix}${coach}`;
        const seatLabel = `${coachLabel}-${String(seat).padStart(2, "0")}`;
        if (!takenSeats.has(seatLabel)) {
          if (!coachNo) coachNo = coachLabel;
          allocatedSeats.push(seatLabel);
        }
      }
    }
    if (allocatedSeats.length !== seats) {
      await connection.rollback();
      transactionStarted = false;
      return res.status(409).json({ error: "Seat labels could not be allocated. Ask an administrator to review this schedule's capacity." });
    }
    const seatNo = allocatedSeats.join(", ");
    const [result] = await connection.query(
      `INSERT INTO bookings (booking_reference, user_id, schedule_id, seats_booked, seat_no, coach_no, travel_class, total_fare, booking_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'CONFIRMED')`,
      [reference, req.user.id, scheduleId, seats, seatNo, coachNo, travelClass, totalFare]
    );
    await connection.query(
      "UPDATE schedules SET available_seats = available_seats - ? WHERE id = ?",
      [seats, scheduleId]
    );
    const transactionRef = `RFP-${Date.now().toString(36).toUpperCase()}-${result.insertId}`;
    await connection.query(
      `INSERT INTO payments (booking_id, amount, payment_method, payment_status, transaction_ref)
       VALUES (?, ?, 'Pending', 'PENDING', ?)`,
      [result.insertId, totalFare, transactionRef]
    );
    await connection.commit();
    transactionStarted = false;
    res.status(201).json({
      message: "Booking and pending payment record saved to the RailFlow database.",
      booking_id: result.insertId,
      booking_reference: reference,
      schedule_id: scheduleId,
      seats_booked: seats,
      seat_no: seatNo,
      coach_no: coachNo,
      total_fare: totalFare,
      booking_status: "CONFIRMED",
      payment_status: "PENDING",
      transaction_ref: transactionRef
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
      pool.query("SELECT COUNT(*) AS total FROM stations"),
      pool.query("SELECT COUNT(*) AS total FROM payments"),
      pool.query("SELECT COALESCE(SUM(amount),0) AS total FROM payments WHERE payment_status = 'SUCCESS'")
    ]);
    const [recentBookings] = await pool.query(`${bookingSelect} ORDER BY b.created_at DESC LIMIT 12`);
    res.json({
      metrics: {
        trains: Number(queries[0][0][0].total),
        schedules: Number(queries[1][0][0].total),
        bookings: Number(queries[2][0][0].total),
        passengers: Number(queries[3][0][0].total),
        stations: Number(queries[4][0][0].total),
        payments: Number(queries[5][0][0].total),
        confirmed_fare_total: Number(queries[6][0][0].total)
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
      `SELECT t.id, t.train_number, t.train_name, t.source, t.destination, t.train_type,
              t.capacity, t.status, COUNT(s.id) AS schedule_count
       FROM trains t LEFT JOIN schedules s ON s.train_id = t.id
       GROUP BY t.id, t.train_number, t.train_name, t.source, t.destination, t.train_type, t.capacity, t.status
       ORDER BY t.train_number`
    );
    res.json(rows);
  } catch (error) { console.error(error.message); res.status(500).json({ error: "Could not load trains." }); }
});

app.get("/api/admin/schedules", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT s.id AS schedule_id, s.train_id, t.train_number, t.train_name, t.train_type,
              r.source_station_id, src.station_code AS source_code, src.station_name AS source_station,
              r.destination_station_id, dst.station_code AS destination_code, dst.station_name AS destination_station,
              s.journey_date, s.departure_time, s.arrival_time, s.available_seats, s.fare,
              (SELECT ts.platform_no FROM train_schedule ts WHERE ts.schedule_id=s.id AND ts.stop_number=1 LIMIT 1) AS source_platform_no,
              (SELECT ts.platform_no FROM train_schedule ts WHERE ts.schedule_id=s.id AND ts.stop_number=2 LIMIT 1) AS destination_platform_no
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
      `SELECT u.id, u.full_name, u.email, u.account_role AS role, u.date_of_birth, u.gender,
              u.phone_no, u.address, u.created_at, COUNT(b.id) AS booking_count
       FROM users u LEFT JOIN bookings b ON b.user_id = u.id
       WHERE u.account_role = 'passenger'
       GROUP BY u.id, u.full_name, u.email, u.account_role, u.date_of_birth, u.gender,
                u.phone_no, u.address, u.created_at
       ORDER BY u.created_at DESC`
    );
    res.json(rows);
  } catch (error) { console.error(error.message); res.status(500).json({ error: "Could not load passengers." }); }
});

app.get("/api/admin/stations", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT st.id, st.station_code, st.station_name, st.city, st.state,
              COUNT(DISTINCT r.schedule_id) AS schedule_count
       FROM stations st
       LEFT JOIN schedule_routes r ON st.id = r.source_station_id OR st.id = r.destination_station_id
       GROUP BY st.id, st.station_code, st.station_name, st.city, st.state
       ORDER BY st.station_name`
    );
    res.json(rows);
  } catch (error) { console.error(error.message); res.status(500).json({ error: "Could not load stations." }); }
});

app.get("/api/admin/payments", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT p.payment_id, p.booking_id, b.booking_reference, u.full_name, u.email,
              t.train_number, p.payment_date, p.amount, p.payment_method,
              p.payment_status, p.transaction_ref, p.created_at
       FROM payments p JOIN bookings b ON b.id=p.booking_id
       JOIN users u ON u.id=b.user_id JOIN schedules s ON s.id=b.schedule_id
       JOIN trains t ON t.id=s.train_id ORDER BY p.created_at DESC`
    );
    res.json(rows);
  } catch (error) { console.error(error.message); res.status(500).json({ error: "Could not load payments." }); }
});

app.get("/api/admin/reports", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT 'Bookings' AS record_type, booking_status, COUNT(*) AS booking_count,
              COALESCE(SUM(total_fare),0) AS fare_total,
              COALESCE(SUM(seats_booked),0) AS seats_total
       FROM bookings GROUP BY booking_status
       UNION ALL
       SELECT 'Payments' AS record_type, payment_status AS booking_status, COUNT(*) AS booking_count,
              COALESCE(SUM(amount),0) AS fare_total, 0 AS seats_total
       FROM payments GROUP BY payment_status
       ORDER BY record_type, booking_status`
    );
    res.json(rows);
  } catch (error) { console.error(error.message); res.status(500).json({ error: "Could not load reports." }); }
});


// Administrative CRUD endpoints. All mutations are protected by requireAdmin.
function cleanText(value, max = 120) { return String(value ?? "").trim().slice(0, max); }
function validId(value) { const id = Number(value); return Number.isInteger(id) && id > 0 ? id : 0; }
function validMoney(value) { const amount = Number(value); return Number.isFinite(amount) && amount >= 0 && amount <= 10000000; }
function duplicateResponse(error, res, label) {
  if (error.code === "ER_DUP_ENTRY") return res.status(409).json({ error: `${label} already exists.` });
  if (error.code === "ER_ROW_IS_REFERENCED_2" || error.code === "ER_ROW_IS_REFERENCED") return res.status(409).json({ error: `This ${label.toLowerCase()} is still used by another record and cannot be deleted.` });
  console.error(`${label} operation failed:`, error.message);
  return res.status(500).json({ error: `Could not save ${label.toLowerCase()}.` });
}

app.post("/api/admin/trains", requireAuth, requireAdmin, async (req, res) => {
  const train = {
    number: cleanText(req.body.train_number, 20), name: cleanText(req.body.train_name, 150),
    source: cleanText(req.body.source, 120), destination: cleanText(req.body.destination, 120),
    type: cleanText(req.body.train_type, 50), capacity: Number(req.body.capacity), status: cleanText(req.body.status || "Active", 20)
  };
  if (!train.number || !train.name || !train.type || !Number.isInteger(train.capacity) || train.capacity < 1 || !["Active", "Scheduled", "Maintenance", "Inactive"].includes(train.status))
    return res.status(400).json({ error: "Enter a train number, name, type, positive capacity and valid status." });
  try {
    const [result] = await pool.query(
      `INSERT INTO trains (train_number, train_name, source, destination, train_type, capacity, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [train.number, train.name, train.source || null, train.destination || null, train.type, train.capacity, train.status]
    );
    res.status(201).json({ message: "Train created.", id: result.insertId });
  } catch (error) { duplicateResponse(error, res, "Train number"); }
});

app.put("/api/admin/trains/:id", requireAuth, requireAdmin, async (req, res) => {
  const id = validId(req.params.id);
  const train = {
    number: cleanText(req.body.train_number, 20), name: cleanText(req.body.train_name, 150),
    source: cleanText(req.body.source, 120), destination: cleanText(req.body.destination, 120),
    type: cleanText(req.body.train_type, 50), capacity: Number(req.body.capacity), status: cleanText(req.body.status || "Active", 20)
  };
  if (!id || !train.number || !train.name || !train.type || !Number.isInteger(train.capacity) || train.capacity < 1 || !["Active", "Scheduled", "Maintenance", "Inactive"].includes(train.status))
    return res.status(400).json({ error: "Enter valid train details." });
  try {
    const [[usage]] = await pool.query(
      `SELECT COALESCE(MAX(s.available_seats + COALESCE(b.booked_seats,0)),0) AS required_capacity
       FROM schedules s
       LEFT JOIN (SELECT schedule_id, SUM(seats_booked) AS booked_seats FROM bookings
                  WHERE booking_status='CONFIRMED' GROUP BY schedule_id) b ON b.schedule_id=s.id
       WHERE s.train_id=?`, [id]
    );
    if (train.capacity < Number(usage.required_capacity)) {
      return res.status(409).json({ error: `Capacity cannot be lower than ${usage.required_capacity} seats required by an existing schedule.` });
    }
    const [result] = await pool.query(
      `UPDATE trains SET train_number=?, train_name=?, source=?, destination=?, train_type=?, capacity=?, status=? WHERE id=?`,
      [train.number, train.name, train.source || null, train.destination || null, train.type, train.capacity, train.status, id]
    );
    if (!result.affectedRows) return res.status(404).json({ error: "Train not found." });
    res.json({ message: "Train updated." });
  } catch (error) { duplicateResponse(error, res, "Train number"); }
});

app.delete("/api/admin/trains/:id", requireAuth, requireAdmin, async (req, res) => {
  const id = validId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid train ID." });
  try {
    const [result] = await pool.query("DELETE FROM trains WHERE id=?", [id]);
    if (!result.affectedRows) return res.status(404).json({ error: "Train not found." });
    res.json({ message: "Train deleted." });
  } catch (error) { duplicateResponse(error, res, "Train"); }
});

app.post("/api/admin/stations", requireAuth, requireAdmin, async (req, res) => {
  const station = [cleanText(req.body.station_code, 10).toUpperCase(), cleanText(req.body.station_name, 120), cleanText(req.body.city, 100), cleanText(req.body.state, 100)];
  if (!/^[A-Z0-9]{2,10}$/.test(station[0]) || !station[1] || !station[2]) return res.status(400).json({ error: "Enter a valid station code, name and city." });
  try {
    const [result] = await pool.query("INSERT INTO stations (station_code, station_name, city, state) VALUES (?, ?, ?, ?)", station);
    res.status(201).json({ message: "Station created.", id: result.insertId });
  } catch (error) { duplicateResponse(error, res, "Station code"); }
});

app.put("/api/admin/stations/:id", requireAuth, requireAdmin, async (req, res) => {
  const id = validId(req.params.id);
  const station = [cleanText(req.body.station_code, 10).toUpperCase(), cleanText(req.body.station_name, 120), cleanText(req.body.city, 100), cleanText(req.body.state, 100)];
  if (!id || !/^[A-Z0-9]{2,10}$/.test(station[0]) || !station[1] || !station[2]) return res.status(400).json({ error: "Enter valid station details." });
  try {
    const [result] = await pool.query("UPDATE stations SET station_code=?, station_name=?, city=?, state=? WHERE id=?", [...station, id]);
    if (!result.affectedRows) return res.status(404).json({ error: "Station not found." });
    res.json({ message: "Station updated." });
  } catch (error) { duplicateResponse(error, res, "Station code"); }
});

app.delete("/api/admin/stations/:id", requireAuth, requireAdmin, async (req, res) => {
  const id = validId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid station ID." });
  try {
    const [result] = await pool.query("DELETE FROM stations WHERE id=?", [id]);
    if (!result.affectedRows) return res.status(404).json({ error: "Station not found." });
    res.json({ message: "Station deleted." });
  } catch (error) { duplicateResponse(error, res, "Station"); }
});

async function saveSchedule(req, res, scheduleId = 0) {
  const trainId = validId(req.body.train_id);
  const sourceId = validId(req.body.source_station_id);
  const destinationId = validId(req.body.destination_station_id);
  const date = cleanText(req.body.journey_date, 10);
  const departure = cleanText(req.body.departure_time, 8);
  const arrival = cleanText(req.body.arrival_time, 8);
  const seats = Number(req.body.available_seats);
  const fare = Number(req.body.fare);
  const sourcePlatform = req.body.source_platform_no === "" || req.body.source_platform_no == null ? null : Number(req.body.source_platform_no);
  const destinationPlatform = req.body.destination_platform_no === "" || req.body.destination_platform_no == null ? null : Number(req.body.destination_platform_no);
  if (!trainId || !sourceId || !destinationId || sourceId === destinationId || !validDate(date) || !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(departure) || !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(arrival) || !Number.isInteger(seats) || seats < 1 || !validMoney(fare))
    return res.status(400).json({ error: "Enter a train, different source and destination stations, valid date/times, seats and fare." });
  if ([sourcePlatform, destinationPlatform].some((value) => value !== null && (!Number.isInteger(value) || value < 1 || value > 99)))
    return res.status(400).json({ error: "Platform numbers must be between 1 and 99." });

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [[trainRows], [stationRows]] = await Promise.all([
      connection.query("SELECT id, capacity, train_name FROM trains WHERE id=?", [trainId]),
      connection.query("SELECT id FROM stations WHERE id IN (?, ?)", [sourceId, destinationId])
    ]);
    if (!trainRows.length || stationRows.length !== 2) { await connection.rollback(); return res.status(400).json({ error: "Selected train or station no longer exists." }); }
    if (Number(trainRows[0].capacity) > 0 && seats > Number(trainRows[0].capacity)) { await connection.rollback(); return res.status(400).json({ error: "Available seats cannot exceed the train capacity." }); }

    let runId = scheduleId;
    if (scheduleId) {
      const [[existing]] = await connection.query(
        `SELECT s.id, s.train_id, s.journey_date, r.source_station_id, r.destination_station_id
         FROM schedules s LEFT JOIN schedule_routes r ON r.schedule_id=s.id WHERE s.id=? FOR UPDATE`, [scheduleId]
      );
      if (!existing) { await connection.rollback(); return res.status(404).json({ error: "Schedule not found." }); }
      const [[booked]] = await connection.query("SELECT COALESCE(SUM(seats_booked),0) AS total FROM bookings WHERE schedule_id=? AND booking_status='CONFIRMED'", [scheduleId]);
      if (Number(booked.total) > 0 && (Number(existing.train_id) !== trainId || String(existing.journey_date).slice(0, 10) !== date || Number(existing.source_station_id) !== sourceId || Number(existing.destination_station_id) !== destinationId)) {
        await connection.rollback();
        return res.status(409).json({ error: "A schedule with booking history cannot be moved to another train, route or journey date." });
      }
      if (Number(trainRows[0].capacity) > 0 && seats + Number(booked.total) > Number(trainRows[0].capacity)) {
        await connection.rollback();
        return res.status(409).json({ error: "Available seats plus confirmed bookings cannot exceed the train capacity." });
      }
      await connection.query(
        "UPDATE schedules SET train_id=?, journey_date=?, departure_time=?, arrival_time=?, available_seats=?, fare=? WHERE id=?",
        [trainId, date, departure, arrival, seats, fare, scheduleId]
      );
      await connection.query(
        `INSERT INTO schedule_routes (schedule_id, source_station_id, destination_station_id) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE source_station_id=VALUES(source_station_id), destination_station_id=VALUES(destination_station_id)`,
        [scheduleId, sourceId, destinationId]
      );
      await connection.query("DELETE FROM train_schedule WHERE schedule_id=?", [scheduleId]);
    } else {
      const [result] = await connection.query(
        "INSERT INTO schedules (train_id, journey_date, departure_time, arrival_time, available_seats, fare) VALUES (?, ?, ?, ?, ?, ?)",
        [trainId, date, departure, arrival, seats, fare]
      );
      runId = result.insertId;
      await connection.query("INSERT INTO schedule_routes (schedule_id, source_station_id, destination_station_id) VALUES (?, ?, ?)", [runId, sourceId, destinationId]);
    }
    await connection.query(
      `INSERT INTO train_schedule (schedule_id, train_id, station_id, arrival_time, departure_time, platform_no, stop_number)
       VALUES (?, ?, ?, NULL, ?, ?, 1), (?, ?, ?, ?, NULL, ?, 2)`,
      [runId, trainId, sourceId, departure, sourcePlatform, runId, trainId, destinationId, arrival, destinationPlatform]
    );
    await connection.query(
      `UPDATE trains SET source=COALESCE(NULLIF(source,''),(SELECT station_name FROM stations WHERE id=?)),
                         destination=COALESCE(NULLIF(destination,''),(SELECT station_name FROM stations WHERE id=?)) WHERE id=?`,
      [sourceId, destinationId, trainId]
    );
    await connection.commit();
    res.status(scheduleId ? 200 : 201).json({ message: scheduleId ? "Schedule updated." : "Schedule created.", schedule_id: runId });
  } catch (error) {
    if (connection) { try { await connection.rollback(); } catch {} }
    duplicateResponse(error, res, "Schedule");
  } finally { if (connection) connection.release(); }
}

app.post("/api/admin/schedules", requireAuth, requireAdmin, (req, res) => saveSchedule(req, res));
app.put("/api/admin/schedules/:id", requireAuth, requireAdmin, (req, res) => {
  const id = validId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid schedule ID." });
  return saveSchedule(req, res, id);
});
app.delete("/api/admin/schedules/:id", requireAuth, requireAdmin, async (req, res) => {
  const id = validId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid schedule ID." });
  try {
    const [[booked]] = await pool.query("SELECT COUNT(*) AS total FROM bookings WHERE schedule_id=?", [id]);
    if (Number(booked.total)) return res.status(409).json({ error: "This schedule has booking history. Cancel bookings instead of deleting it." });
    const [result] = await pool.query("DELETE FROM schedules WHERE id=?", [id]);
    if (!result.affectedRows) return res.status(404).json({ error: "Schedule not found." });
    res.json({ message: "Schedule deleted." });
  } catch (error) { duplicateResponse(error, res, "Schedule"); }
});

app.patch("/api/admin/bookings/:id", requireAuth, requireAdmin, async (req, res) => {
  const id = validId(req.params.id);
  const status = cleanText(req.body.booking_status, 20).toUpperCase();
  if (!id || !["CONFIRMED", "CANCELLED"].includes(status)) return res.status(400).json({ error: "Choose CONFIRMED or CANCELLED." });
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [[booking]] = await connection.query("SELECT id, schedule_id, seats_booked, booking_status FROM bookings WHERE id=? FOR UPDATE", [id]);
    if (!booking) { await connection.rollback(); return res.status(404).json({ error: "Booking not found." }); }
    if (booking.booking_status !== status) {
      await connection.query("UPDATE bookings SET booking_status=? WHERE id=?", [status, id]);
      if (booking.booking_status === "CONFIRMED" && status === "CANCELLED") {
        await connection.query("UPDATE schedules SET available_seats=available_seats+? WHERE id=?", [booking.seats_booked, booking.schedule_id]);
        await connection.query("UPDATE payments SET payment_status=CASE WHEN payment_status='SUCCESS' THEN 'REFUNDED' ELSE 'FAILED' END WHERE booking_id=?", [id]);
      } else if (booking.booking_status === "CANCELLED" && status === "CONFIRMED") {
        const [[schedule]] = await connection.query("SELECT available_seats FROM schedules WHERE id=? FOR UPDATE", [booking.schedule_id]);
        if (!schedule || Number(schedule.available_seats) < Number(booking.seats_booked)) { await connection.rollback(); return res.status(409).json({ error: "Not enough seats are available to reinstate this booking." }); }
        await connection.query("UPDATE schedules SET available_seats=available_seats-? WHERE id=?", [booking.seats_booked, booking.schedule_id]);
        await connection.query("UPDATE payments SET payment_status='PENDING', payment_date=NULL WHERE booking_id=?", [id]);
      }
    }
    await connection.commit();
    res.json({ message: `Booking ${status.toLowerCase()}.` });
  } catch (error) {
    if (connection) { try { await connection.rollback(); } catch {} }
    console.error("Booking status update failed:", error.message);
    res.status(500).json({ error: "Could not update booking status." });
  } finally { if (connection) connection.release(); }
});

app.patch("/api/admin/passengers/:id", requireAuth, requireAdmin, async (req, res) => {
  const id = validId(req.params.id);
  const fullName = cleanText(req.body.full_name, 100);
  const dob = req.body.date_of_birth ? cleanText(req.body.date_of_birth, 10) : null;
  const gender = cleanText(req.body.gender, 20);
  const phone = cleanText(req.body.phone_no, 20);
  const address = cleanText(req.body.address, 250);
  if (!id || fullName.length < 2 || (dob && !validDate(dob))) return res.status(400).json({ error: "Enter a valid passenger name and date of birth." });
  try {
    const [result] = await pool.query(
      "UPDATE users SET full_name=?, date_of_birth=?, gender=?, phone_no=?, address=? WHERE id=? AND account_role='passenger'",
      [fullName, dob, gender || null, phone || null, address || null, id]
    );
    if (!result.affectedRows) return res.status(404).json({ error: "Passenger not found." });
    res.json({ message: "Passenger details updated." });
  } catch (error) { duplicateResponse(error, res, "Passenger"); }
});

app.patch("/api/admin/payments/:id", requireAuth, requireAdmin, async (req, res) => {
  const id = validId(req.params.id);
  const method = cleanText(req.body.payment_method, 30);
  const status = cleanText(req.body.payment_status, 20).toUpperCase();
  const methods = ["UPI", "Card", "Net Banking", "Cash", "Pending"];
  if (!id || !methods.includes(method) || !["PENDING", "SUCCESS", "FAILED", "REFUNDED"].includes(status))
    return res.status(400).json({ error: "Choose a valid payment method and payment status." });
  try {
    const [result] = await pool.query(
      `UPDATE payments SET payment_method=?, payment_status=?,
       payment_date=CASE WHEN ?='SUCCESS' THEN COALESCE(payment_date, NOW()) WHEN ? IN ('PENDING','FAILED') THEN NULL ELSE payment_date END
       WHERE payment_id=?`, [method, status, status, status, id]
    );
    if (!result.affectedRows) return res.status(404).json({ error: "Payment not found." });
    res.json({ message: "Payment record updated. No money was processed by this demo project." });
  } catch (error) { duplicateResponse(error, res, "Payment"); }
});

app.delete("/api/admin/payments/:id", requireAuth, requireAdmin, async (req, res) => {
  const id = validId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid payment ID." });
  try {
    const [result] = await pool.query("DELETE FROM payments WHERE payment_id=?", [id]);
    if (!result.affectedRows) return res.status(404).json({ error: "Payment not found." });
    res.json({ message: "Payment record deleted." });
  } catch (error) { duplicateResponse(error, res, "Payment"); }
});

app.listen(PORT, () => {
  console.log(`RailFlow backend running on port ${PORT}`);
  console.log("Demo note: seeded schedules and fares are illustrative, not live railway data.");
});

module.exports = app;
