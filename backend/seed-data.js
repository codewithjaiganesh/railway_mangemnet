require("dotenv").config({ path: require("path").join(__dirname, ".env") });
const pool = require("./db");

const stationRows = [
  ["HYB", "Hyderabad Deccan", "Hyderabad", "Telangana"],
  ["SC", "Secunderabad Junction", "Secunderabad", "Telangana"],
  ["BZA", "Vijayawada Junction", "Vijayawada", "Andhra Pradesh"],
  ["MAS", "Chennai Central", "Chennai", "Tamil Nadu"],
  ["SBC", "Bengaluru City", "Bengaluru", "Karnataka"],
  ["MMCT", "Mumbai Central", "Mumbai", "Maharashtra"],
  ["NDLS", "New Delhi", "New Delhi", "Delhi"],
  ["VSKP", "Visakhapatnam", "Visakhapatnam", "Andhra Pradesh"],
  ["TPTY", "Tirupati", "Tirupati", "Andhra Pradesh"],
  ["PUNE", "Pune Junction", "Pune", "Maharashtra"]
];

const trainRows = [
  ["RF1001", "RailFlow Demo Express", "Express", "Hyderabad Deccan", "Chennai Central", 1200, "Active"],
  ["RF1002", "Deccan Sample Express", "Express", "Hyderabad Deccan", "Visakhapatnam", 900, "Active"],
  ["RF1003", "Coastal Sample Express", "Intercity", "Secunderabad Junction", "Vijayawada Junction", 800, "Active"],
  ["RF1004", "Southern Sample Connector", "Superfast", "Bengaluru City", "New Delhi", 1000, "Scheduled"],
  ["RF1005", "Krishna Valley Demo Express", "Express", "Hyderabad Deccan", "Vijayawada Junction", 900, "Active"],
  ["RF1006", "Tirupati Sample Connector", "Intercity", "Hyderabad Deccan", "Tirupati", 700, "Active"],
  ["12727", "Godavari Express (Demo record)", "Express", "Hyderabad Deccan", "Visakhapatnam", 900, "Active"],
  ["12740", "Garib Rath Express (Demo record)", "Superfast", "Secunderabad Junction", "Visakhapatnam", 850, "Active"]
];

const schedules = [
  { train: "RF1001", from: "HYB", to: "MAS", departure: "18:10:00", arrival: "06:50:00", seats: 100, fare: 650, sourcePlatform: 1, destinationPlatform: 4 },
  { train: "RF1002", from: "HYB", to: "VSKP", departure: "17:30:00", arrival: "06:30:00", seats: 80, fare: 580, sourcePlatform: 2, destinationPlatform: 3 },
  { train: "RF1003", from: "SC", to: "BZA", departure: "07:30:00", arrival: "12:30:00", seats: 90, fare: 420, sourcePlatform: 5, destinationPlatform: 2 },
  { train: "RF1004", from: "SBC", to: "NDLS", departure: "20:15:00", arrival: "10:45:00", seats: 70, fare: 950, sourcePlatform: 6, destinationPlatform: 8 },
  { train: "RF1005", from: "HYB", to: "BZA", departure: "09:20:00", arrival: "14:10:00", seats: 110, fare: 350, sourcePlatform: 3, destinationPlatform: 1 },
  { train: "RF1006", from: "HYB", to: "TPTY", departure: "21:00:00", arrival: "07:20:00", seats: 65, fare: 520, sourcePlatform: 4, destinationPlatform: 2 }
];

async function seedData() {
  try {
    for (const station of stationRows) {
      await pool.query(
        `INSERT INTO stations (station_code, station_name, city, state) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE station_name=VALUES(station_name), city=VALUES(city), state=VALUES(state)`,
        station
      );
    }
    for (const train of trainRows) {
      await pool.query(
        `INSERT INTO trains (train_number, train_name, train_type, source, destination, capacity, status)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE train_name=VALUES(train_name), train_type=VALUES(train_type),
           source=IF(source IS NULL OR source='', VALUES(source), source),
           destination=IF(destination IS NULL OR destination='', VALUES(destination), destination),
           capacity=IF(capacity=0, VALUES(capacity), capacity)`,
        train
      );
    }

    // Seed a rolling seven-day demo timetable so the date picker remains useful
    // even if the presentation is scheduled for another day this week.
    for (const item of schedules) {
      for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
        const dateExpression = dayOffset === 0
          ? "CURDATE()"
          : `DATE_ADD(CURDATE(), INTERVAL ${dayOffset} DAY)`;

        await pool.query(
          `INSERT INTO schedules (train_id, journey_date, departure_time, arrival_time, available_seats, fare)
           SELECT t.id, ${dateExpression}, ?, ?, ?, ?
           FROM trains t
           WHERE t.train_number = ?
             AND NOT EXISTS (
               SELECT 1 FROM schedules s
               WHERE s.train_id = t.id AND s.journey_date = ${dateExpression} AND s.departure_time = ?
             )`,
          [item.departure, item.arrival, item.seats, item.fare, item.train, item.departure]
        );

        await pool.query(
          `INSERT INTO schedule_routes (schedule_id, source_station_id, destination_station_id)
           SELECT s.id, src.id, dst.id
           FROM schedules s
           JOIN trains t ON t.id = s.train_id
           JOIN stations src ON src.station_code = ?
           JOIN stations dst ON dst.station_code = ?
           WHERE t.train_number = ? AND s.journey_date = ${dateExpression} AND s.departure_time = ?
           ON DUPLICATE KEY UPDATE source_station_id = VALUES(source_station_id),
                                   destination_station_id = VALUES(destination_station_id)`,
          [item.from, item.to, item.train, item.departure]
        );

        await pool.query(
          `INSERT INTO train_schedule (schedule_id, train_id, station_id, arrival_time, departure_time, platform_no, stop_number)
           SELECT s.id, s.train_id, src.id, NULL, s.departure_time, ?, 1
           FROM schedules s JOIN trains t ON t.id=s.train_id
           JOIN schedule_routes r ON r.schedule_id=s.id JOIN stations src ON src.id=r.source_station_id
           WHERE t.train_number=? AND s.journey_date=${dateExpression} AND s.departure_time=?
           ON DUPLICATE KEY UPDATE station_id=VALUES(station_id), departure_time=VALUES(departure_time), platform_no=VALUES(platform_no)`,
          [item.sourcePlatform || null, item.train, item.departure]
        );
        await pool.query(
          `INSERT INTO train_schedule (schedule_id, train_id, station_id, arrival_time, departure_time, platform_no, stop_number)
           SELECT s.id, s.train_id, dst.id, s.arrival_time, NULL, ?, 2
           FROM schedules s JOIN trains t ON t.id=s.train_id
           JOIN schedule_routes r ON r.schedule_id=s.id JOIN stations dst ON dst.id=r.destination_station_id
           WHERE t.train_number=? AND s.journey_date=${dateExpression} AND s.departure_time=?
           ON DUPLICATE KEY UPDATE station_id=VALUES(station_id), arrival_time=VALUES(arrival_time), platform_no=VALUES(platform_no)`,
          [item.destinationPlatform || null, item.train, item.departure]
        );
      }
    }

    const [stationResults] = await pool.query("SELECT station_code, station_name, city FROM stations ORDER BY station_code");
    const [scheduleResults] = await pool.query(
      `SELECT t.train_number, t.train_name, src.station_code AS from_code,
              dst.station_code AS to_code, s.journey_date, s.departure_time,
              s.arrival_time, s.available_seats, s.fare
       FROM schedules s JOIN trains t ON t.id = s.train_id
       JOIN schedule_routes r ON r.schedule_id = s.id
       JOIN stations src ON src.id = r.source_station_id
       JOIN stations dst ON dst.id = r.destination_station_id
       WHERE s.journey_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 6 DAY) ORDER BY s.journey_date, s.departure_time`
    );
    console.log("Stations available:");
    console.table(stationResults);
    console.log("Upcoming RailFlow demo schedules (next 7 days):");
    console.table(scheduleResults);
    console.log("Seed completed. Stations, trains, seven-day schedules and train stops are available. Fares/routes are illustrative demo data, not live railway inventory.");
  } catch (error) {
    console.error("Seed failed:", error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

seedData();
