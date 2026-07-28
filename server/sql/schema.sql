CREATE DATABASE IF NOT EXISTS stream_curator
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE stream_curator;

CREATE TABLE IF NOT EXISTS streamers (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  display_name VARCHAR(128) NOT NULL,
  notes TEXT NULL,
  timezone VARCHAR(64) NOT NULL DEFAULT 'UTC',
  avatar_url VARCHAR(1024) NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_streamers_display_name (display_name),
  KEY idx_streamers_sort_order (sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS streamer_platforms (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  streamer_id INT UNSIGNED NOT NULL,
  platform ENUM('twitch', 'kick', 'youtube', 'rumble', 'x') NOT NULL,
  username VARCHAR(255) NOT NULL,
  -- Optional platform-specific IDs (e.g. YouTube channel ID)
  external_id VARCHAR(255) NULL,
  is_primary TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_streamer_platform (streamer_id, platform),
  CONSTRAINT fk_platforms_streamer
    FOREIGN KEY (streamer_id) REFERENCES streamers(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- day_of_week: 0 = Sunday … 6 = Saturday
-- times stored as TIME (local to streamer timezone)
CREATE TABLE IF NOT EXISTS stream_schedules (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  streamer_id INT UNSIGNED NOT NULL,
  day_of_week TINYINT UNSIGNED NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_schedule_day (streamer_id, day_of_week),
  CONSTRAINT chk_day CHECK (day_of_week BETWEEN 0 AND 6),
  CONSTRAINT fk_schedules_streamer
    FOREIGN KEY (streamer_id) REFERENCES streamers(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
