-- RailFlow database schema. This migration is additive: existing rows are preserved.
-- The system keeps users as the authentication-backed PASSENGER entity.

CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    full_name VARCHAR(100) NOT NULL,
    email VARCHAR(150) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    account_role ENUM('passenger','admin') NOT NULL DEFAULT 'passenger',
    date_of_birth DATE NULL,
    gender VARCHAR(20) NULL,
    phone_no VARCHAR(20) NULL,
    address VARCHAR(250) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS stations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    station_code VARCHAR(10) NOT NULL UNIQUE,
    station_name VARCHAR(120) NOT NULL,
    city VARCHAR(100) NOT NULL,
    state VARCHAR(100) NULL
);

CREATE TABLE IF NOT EXISTS trains (
    id INT AUTO_INCREMENT PRIMARY KEY,
    train_number VARCHAR(20) NOT NULL UNIQUE,
    train_name VARCHAR(150) NOT NULL,
    source VARCHAR(120) NULL,
    destination VARCHAR(120) NULL,
    train_type VARCHAR(50),
    capacity INT NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'Active'
);

-- A dated train run with seat availability and fare.
CREATE TABLE IF NOT EXISTS schedules (
    id INT AUTO_INCREMENT PRIMARY KEY,
    train_id INT NOT NULL,
    journey_date DATE NOT NULL,
    departure_time TIME NOT NULL,
    arrival_time TIME NOT NULL,
    available_seats INT NOT NULL DEFAULT 0,
    fare DECIMAL(10,2) NOT NULL,
    FOREIGN KEY (train_id) REFERENCES trains(id),
    INDEX idx_schedules_date_train (journey_date, train_id)
);

-- Explicit source/destination mapping used by the train-search endpoint.
CREATE TABLE IF NOT EXISTS schedule_routes (
    schedule_id INT PRIMARY KEY,
    source_station_id INT NOT NULL,
    destination_station_id INT NOT NULL,
    FOREIGN KEY (schedule_id) REFERENCES schedules(id) ON DELETE CASCADE,
    FOREIGN KEY (source_station_id) REFERENCES stations(id),
    FOREIGN KEY (destination_station_id) REFERENCES stations(id),
    INDEX idx_schedule_routes_source_dest (source_station_id, destination_station_id)
);

-- TRAIN_SCHEDULE entity from the ER model: one row per stop in a dated run.
CREATE TABLE IF NOT EXISTS train_schedule (
    train_schedule_id INT AUTO_INCREMENT PRIMARY KEY,
    schedule_id INT NOT NULL,
    train_id INT NOT NULL,
    station_id INT NOT NULL,
    arrival_time TIME NULL,
    departure_time TIME NULL,
    platform_no INT NULL,
    stop_number INT NOT NULL,
    FOREIGN KEY (schedule_id) REFERENCES schedules(id) ON DELETE CASCADE,
    FOREIGN KEY (train_id) REFERENCES trains(id),
    FOREIGN KEY (station_id) REFERENCES stations(id),
    UNIQUE KEY uq_train_schedule_stop (schedule_id, stop_number),
    INDEX idx_train_schedule_station (station_id, train_id)
);

CREATE TABLE IF NOT EXISTS bookings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    booking_reference VARCHAR(30) NOT NULL UNIQUE,
    user_id INT NOT NULL,
    schedule_id INT NOT NULL,
    seats_booked INT NOT NULL,
    seat_no VARCHAR(100) NULL,
    coach_no VARCHAR(20) NULL,
    travel_class VARCHAR(50) NOT NULL DEFAULT 'Sleeper',
    total_fare DECIMAL(10,2) NOT NULL,
    booking_status ENUM('CONFIRMED','CANCELLED') NOT NULL DEFAULT 'CONFIRMED',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (schedule_id) REFERENCES schedules(id),
    INDEX idx_bookings_user_created (user_id, created_at),
    INDEX idx_bookings_schedule (schedule_id)
);

CREATE TABLE IF NOT EXISTS payments (
    payment_id INT AUTO_INCREMENT PRIMARY KEY,
    booking_id INT NOT NULL UNIQUE,
    payment_date DATETIME NULL,
    amount DECIMAL(10,2) NOT NULL,
    payment_method VARCHAR(30) NOT NULL DEFAULT 'Pending',
    payment_status ENUM('PENDING','SUCCESS','FAILED','REFUNDED') NOT NULL DEFAULT 'PENDING',
    transaction_ref VARCHAR(50) NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
    INDEX idx_payments_status_date (payment_status, payment_date)
);
