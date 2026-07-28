/**
 * Re-apply table DDL using app credentials (no root required).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST || 'localhost',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'stream_curator',
    password: process.env.MYSQL_PASSWORD || 'stream_curator_pass',
    database: process.env.MYSQL_DATABASE || 'stream_curator',
    multipleStatements: true,
  });

  const schemaPath = path.resolve(__dirname, '../../sql/schema.sql');
  // schema.sql includes CREATE DATABASE / USE — skip those when already connected to DB
  let sql = fs.readFileSync(schemaPath, 'utf8');
  sql = sql
    .replace(/CREATE DATABASE[\s\S]*?;/i, '')
    .replace(/USE\s+\w+\s*;/i, '');

  await conn.query(sql);
  await conn.end();
  console.log('Migration applied.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
