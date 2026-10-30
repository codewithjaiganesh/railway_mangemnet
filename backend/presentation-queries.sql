-- RailFlow classroom presentation queries (MySQL / Aiven).
-- Run with: npm run db:console, or paste into a trusted SQL client connected to defaultdb.
-- These statements are SELECT-only. Use the admin workspace to make controlled changes.

SHOW TABLES;

-- 1. RAILWAY_TRAIN entity (represented by trains).
SELECT id AS train_id, train_number, train_name, source, destination, train_type, capacity, status
FROM trains ORDER BY train_number;

-- 2. STATION entity.
SELECT id AS station_id, station_code, station_name, city, state
FROM stations ORDER BY station_name;

-- 3. TRAIN_SCHEDULE entity: station-by-station stop data for each dated run.
SELECT ts.train_schedule_id, ts.schedule_id, t.train_number, t.train_name,
       st.station_code, st.station_name, ts.arrival_time, ts.departure_time,
       ts.platform_no, ts.stop_number, s.journey_date
FROM train_schedule ts
JOIN trains t ON t.id=ts.train_id
JOIN stations st ON st.id=ts.station_id
JOIN schedules s ON s.id=ts.schedule_id
ORDER BY s.journey_date, t.train_number, ts.stop_number;

-- 4. PASSENGER entity (users table; admin accounts are excluded).
SELECT id AS passenger_id, full_name AS passenger_name, date_of_birth, gender,
       phone_no, email AS email_id, address
FROM users WHERE account_role='passenger' ORDER BY id DESC;

-- 5. BOOKING entity: run this after creating a booking in the passenger portal.
SELECT * FROM bookings ORDER BY id DESC;

-- 6. PAYMENT entity: a booking creates a PENDING record. Admin can update the demo record.
SELECT * FROM payments ORDER BY payment_id DESC;

-- Full booking details: passenger + train + route + seat allocation.
SELECT b.id AS booking_id, b.booking_reference, u.full_name AS passenger_name,
       t.train_number, t.train_name, src.station_name AS source, dst.station_name AS destination,
       s.journey_date, b.seat_no, b.coach_no, b.travel_class AS class_type,
       b.total_fare AS fare, b.booking_status
FROM bookings b
JOIN users u ON u.id=b.user_id
JOIN schedules s ON s.id=b.schedule_id
JOIN trains t ON t.id=s.train_id
LEFT JOIN schedule_routes r ON r.schedule_id=s.id
LEFT JOIN stations src ON src.id=r.source_station_id
LEFT JOIN stations dst ON dst.id=r.destination_station_id
ORDER BY b.id DESC;

-- Payments with the related booking.
SELECT p.payment_id, b.booking_reference, u.full_name AS passenger_name,
       p.payment_date, p.amount, p.payment_method, p.payment_status, p.transaction_ref
FROM payments p JOIN bookings b ON b.id=p.booking_id
JOIN users u ON u.id=b.user_id ORDER BY p.payment_id DESC;

-- Reports from the PDF: confirmed fare by train and booking count by class.
SELECT s.train_id, SUM(b.total_fare) AS total_fare
FROM bookings b JOIN schedules s ON s.id=b.schedule_id
WHERE b.booking_status='CONFIRMED' GROUP BY s.train_id;

SELECT travel_class AS class_type, COUNT(*) AS booking_count
FROM bookings GROUP BY travel_class;

SELECT MAX(total_fare) AS highest_booking_fare FROM bookings;
