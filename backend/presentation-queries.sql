-- Run these using: npm run db:console (or node sql-console.js from backend/).
-- The interactive console only permits read-only queries to keep presentation data safe.

SHOW TABLES;

-- See all train definitions (includes clearly-labelled demo trains).
SELECT * FROM trains;

-- See all routes/schedules and current available seats.
SELECT s.id AS schedule_id, t.train_number, t.train_name,
       src.station_code AS from_code, src.station_name AS from_station,
       dst.station_code AS to_code, dst.station_name AS to_station,
       s.journey_date, s.departure_time, s.arrival_time,
       s.available_seats, s.fare
FROM schedules s
JOIN trains t ON t.id = s.train_id
LEFT JOIN schedule_routes r ON r.schedule_id = s.id
LEFT JOIN stations src ON src.id = r.source_station_id
LEFT JOIN stations dst ON dst.id = r.destination_station_id
ORDER BY s.journey_date, s.departure_time;

-- The key classroom demonstration: after booking through the website, re-run this.
SELECT * FROM bookings;

-- More readable proof with passenger, train and journey context.
SELECT b.id, b.booking_reference, u.full_name, u.email,
       t.train_number, t.train_name, s.journey_date,
       b.seats_booked, b.travel_class, b.total_fare,
       b.booking_status, b.created_at
FROM bookings b
JOIN users u ON u.id = b.user_id
JOIN schedules s ON s.id = b.schedule_id
JOIN trains t ON t.id = s.train_id
ORDER BY b.id DESC;
