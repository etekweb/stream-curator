import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const config = {
  host: process.env.MYSQL_HOST || 'localhost',
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || 'stream_curator',
  password: process.env.MYSQL_PASSWORD || 'stream_curator_pass',
  database: process.env.MYSQL_DATABASE || 'stream_curator',
  waitForConnections: true,
  connectionLimit: 10,
  namedPlaceholders: true,
  timezone: 'Z' as const,
  dateStrings: true as const,
};

export const pool = mysql.createPool(config);

export async function query<T = unknown>(
  sql: string,
  params?: Record<string, unknown> | unknown[]
): Promise<T[]> {
  const [rows] = await pool.execute(sql, params as never);
  return rows as T[];
}

export async function queryOne<T = unknown>(
  sql: string,
  params?: Record<string, unknown> | unknown[]
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

export async function withTransaction<T>(
  fn: (conn: mysql.PoolConnection) => Promise<T>
): Promise<T> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export function getDbConfig() {
  return { ...config, password: '***' };
}
