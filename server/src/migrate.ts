import type { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';

/**
 * Lightweight additive migrations for existing DBs.
 * Safe to run on every server start.
 */
async function addColumn(pool: Pool, sql: string, label: string): Promise<void> {
  try {
    await pool.query(sql);
    console.log(`Migration: ${label}`);
  } catch (err) {
    const e = err as { code?: string; errno?: number };
    // ER_DUP_FIELDNAME
    if (e.code !== 'ER_DUP_FIELDNAME' && e.errno !== 1060) {
      throw err;
    }
  }
}

export async function ensureSchema(pool: Pool): Promise<void> {
  await addColumn(
    pool,
    `ALTER TABLE streamers
     ADD COLUMN sort_order INT NOT NULL DEFAULT 0 AFTER timezone`,
    'added streamers.sort_order'
  );

  await addColumn(
    pool,
    `ALTER TABLE streamers
     ADD COLUMN avatar_url VARCHAR(1024) NULL AFTER timezone`,
    'added streamers.avatar_url'
  );

  try {
    await pool.query(
      `ALTER TABLE streamers ADD KEY idx_streamers_sort_order (sort_order)`
    );
  } catch (err) {
    const e = err as { code?: string; errno?: number };
    // ER_DUP_KEYNAME
    if (e.code !== 'ER_DUP_KEYNAME' && e.errno !== 1061) {
      throw err;
    }
  }

  // Backfill when every row still has default 0 (first boot after migration)
  const [countRows] = await pool.query<RowDataPacket[]>(
    `SELECT
       SUM(CASE WHEN sort_order = 0 THEN 1 ELSE 0 END) AS zero_cnt,
       COUNT(*) AS total
     FROM streamers`
  );
  const zeroCnt = Number(countRows[0]?.zero_cnt ?? 0);
  const total = Number(countRows[0]?.total ?? 0);

  if (total > 0 && zeroCnt === total) {
    const [ids] = await pool.query<RowDataPacket[]>(
      'SELECT id FROM streamers ORDER BY id ASC'
    );
    for (let i = 0; i < ids.length; i++) {
      await pool.execute<ResultSetHeader>(
        'UPDATE streamers SET sort_order = ? WHERE id = ?',
        [(i + 1) * 10, ids[i]!.id]
      );
    }
    console.log(`Migration: backfilled sort_order for ${ids.length} streamers`);
  }
}
