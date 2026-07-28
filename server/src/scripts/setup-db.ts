/**
 * Creates MySQL database, app user, and schema.
 * Usage:
 *   MYSQL_ROOT_PASSWORD=... npm run db:setup
 * Or interactive prompt when TTY is available.
 */
import mysql from 'mysql2/promise';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootEnv = path.resolve(__dirname, '../../../.env');
const rootEnvExample = path.resolve(__dirname, '../../../.env.example');

dotenv.config({ path: rootEnv });

const DB_NAME = process.env.MYSQL_DATABASE || 'stream_curator';
const DB_USER = process.env.MYSQL_USER || 'stream_curator';
const DB_PASS = process.env.MYSQL_PASSWORD || 'stream_curator_pass';
const DB_HOST = process.env.MYSQL_HOST || 'localhost';
const DB_PORT = Number(process.env.MYSQL_PORT || 3306);

async function prompt(question: string, silent = false): Promise<string> {
  if (!process.stdin.isTTY) {
    throw new Error(
      'No TTY and MYSQL_ROOT_PASSWORD not set. Export MYSQL_ROOT_PASSWORD and re-run.'
    );
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    if (!silent) {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer);
      });
      return;
    }
    // Basic silent-ish prompt (Node doesn't hide input easily without raw mode)
    process.stdout.write(question);
    let input = '';
    process.stdin.setRawMode?.(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    const onData = (char: string) => {
      if (char === '\n' || char === '\r' || char === '\u0004') {
        process.stdin.setRawMode?.(false);
        process.stdin.removeListener('data', onData);
        process.stdout.write('\n');
        rl.close();
        resolve(input);
      } else if (char === '\u0003') {
        process.exit(1);
      } else if (char === '\u007f') {
        input = input.slice(0, -1);
      } else {
        input += char;
        process.stdout.write('*');
      }
    };
    process.stdin.on('data', onData);
  });
}

async function main() {
  let rootPassword =
    process.env.MYSQL_ROOT_PASSWORD ?? process.env.MYSQL_ROOT_PW ?? '';

  if (!rootPassword) {
    console.log('MySQL root password is required to create the database and app user.');
    rootPassword = await prompt('Enter MySQL root password: ', true);
  }

  const conn = await mysql.createConnection({
    host: DB_HOST,
    port: DB_PORT,
    user: 'root',
    password: rootPassword,
    multipleStatements: true,
  });

  console.log('Connected as root. Creating database and user…');

  await conn.query(
    `CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\`
     CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );

  // MySQL 5.7 vs 8: CREATE USER IF NOT EXISTS is 5.7.6+
  try {
    await conn.query(
      `CREATE USER IF NOT EXISTS ?@'localhost' IDENTIFIED BY ?`,
      [DB_USER, DB_PASS]
    );
  } catch {
    // Fallback for older syntax quirks
    try {
      await conn.query(`CREATE USER ?@'localhost' IDENTIFIED BY ?`, [
        DB_USER,
        DB_PASS,
      ]);
    } catch (e: unknown) {
      const err = e as { code?: string };
      if (err.code !== 'ER_CANNOT_USER' && err.code !== 'ER_USER_ALREADY_EXISTS') {
        // Try update password if user exists
        await conn.query(`SET PASSWORD FOR ?@'localhost' = PASSWORD(?)`, [
          DB_USER,
          DB_PASS,
        ]).catch(async () => {
          await conn.query(`ALTER USER ?@'localhost' IDENTIFIED BY ?`, [
            DB_USER,
            DB_PASS,
          ]);
        });
      }
    }
  }

  // Also allow 127.0.0.1 host
  try {
    await conn.query(`CREATE USER IF NOT EXISTS ?@'127.0.0.1' IDENTIFIED BY ?`, [
      DB_USER,
      DB_PASS,
    ]);
  } catch {
    /* ignore */
  }

  await conn.query(
    `GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO ?@'localhost'`,
    [DB_USER]
  );
  try {
    await conn.query(
      `GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO ?@'127.0.0.1'`,
      [DB_USER]
    );
  } catch {
    /* ignore */
  }
  await conn.query('FLUSH PRIVILEGES');

  // Apply schema tables
  await conn.query(`USE \`${DB_NAME}\``);

  await conn.query(`
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
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS streamer_platforms (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      streamer_id INT UNSIGNED NOT NULL,
      platform ENUM('twitch', 'kick', 'youtube', 'rumble', 'x') NOT NULL,
      username VARCHAR(255) NOT NULL,
      external_id VARCHAR(255) NULL,
      is_primary TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_streamer_platform (streamer_id, platform),
      CONSTRAINT fk_platforms_streamer
        FOREIGN KEY (streamer_id) REFERENCES streamers(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await conn.query(`
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
      CONSTRAINT fk_schedules_streamer
        FOREIGN KEY (streamer_id) REFERENCES streamers(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await conn.end();

  // Ensure .env exists
  if (!fs.existsSync(rootEnv)) {
    const example = fs.readFileSync(rootEnvExample, 'utf8');
    fs.writeFileSync(
      rootEnv,
      example
        .replace(/MYSQL_USER=.*/, `MYSQL_USER=${DB_USER}`)
        .replace(/MYSQL_PASSWORD=.*/, `MYSQL_PASSWORD=${DB_PASS}`)
        .replace(/MYSQL_DATABASE=.*/, `MYSQL_DATABASE=${DB_NAME}`)
    );
    console.log('Wrote .env from .env.example');
  }

  console.log(`
Database ready:
  host:     ${DB_HOST}:${DB_PORT}
  database: ${DB_NAME}
  user:     ${DB_USER}
`);
}

main().catch((err) => {
  console.error('Setup failed:', err.message || err);
  process.exit(1);
});
