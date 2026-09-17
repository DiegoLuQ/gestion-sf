// Pool de conexiones MySQL y helpers de consulta.
import mysql from 'mysql2/promise';

export function connectionConfig(url = process.env.DATABASE_URL) {
  if (url) {
    const u = new URL(url.replace(/^mysql\+\w+:\/\//, 'mysql://'));
    return {
      host: u.hostname || 'localhost',
      port: Number(u.port) || 3306,
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: u.pathname.replace(/^\//, ''),
    };
  }
  // Alternativa para paneles como Hostinger, donde es más cómodo cargar variables sueltas.
  return {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  };
}

// dateStrings: las fechas llegan como 'AAAA-MM-DD' sin conversiones de zona horaria.
// decimalNumbers: los DECIMAL llegan como número y no como texto.
export const COMMON_OPTIONS = { charset: 'utf8mb4', dateStrings: true, decimalNumbers: true };

export const pool = mysql.createPool({
  ...connectionConfig(),
  ...COMMON_OPTIONS,
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_POOL_SIZE) || 10,
});

function helpers(executor) {
  return {
    all: async (sql, params = []) => (await executor.query(sql, params))[0],
    one: async (sql, params = []) => (await executor.query(sql, params))[0][0] ?? null,
    run: async (sql, params = []) => (await executor.query(sql, params))[0],
  };
}

export const db = helpers(pool);

export async function transaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(helpers(conn));
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
