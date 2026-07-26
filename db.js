/**
 * db.js
 * MySQL connection pool + auto database/schema creation.
 * Uses mysql2/promise with prepared statements everywhere (SQL injection protection).
 */
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const config = require('./config');

let pool = null;

/**
 * Creates the database itself (if missing) using a temporary connection
 * that does not select a database yet.
 */
async function ensureDatabaseExists() {
  const conn = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
  });

  await conn.query(
    `CREATE DATABASE IF NOT EXISTS \`${config.db.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  await conn.end();
}

/**
 * Runs the full database.sql schema against the pool.
 * Splits on semicolons that terminate statements (schema file has no
 * semicolons inside strings so a simple split is safe here).
 */
async function runSchema() {
  const schemaPath = path.join(__dirname, 'database.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');

  const rawStatements = sql.split(/;\s*[\r\n]+/);

  const statements = rawStatements
    .map((s) => s.replace(/--.*$/gm, '').trim()) // strip comment lines FIRST
    .filter((s) => s.length > 0); // THEN drop anything left empty

  const conn = await pool.getConnection();
  try {
    for (const stmt of statements) {
      if (!stmt) continue;
      await conn.query(stmt);
    }
  } finally {
    conn.release();
  }
}

async function initDb() {
  await ensureDatabaseExists();

  pool = mysql.createPool({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    waitForConnections: true,
    connectionLimit: config.db.connectionLimit,
    queueLimit: 0,
    dateStrings: true,
  });

  await runSchema();
  return pool;
}

function getPool() {
  if (!pool) {
    throw new Error('Database pool not initialized. Call initDb() first.');
  }
  return pool;
}

/**
 * Convenience query helper - always uses prepared statements (? placeholders).
 */
async function query(sql, params = []) {
  const conn = getPool();

  console.log("========== SQL ==========");
  console.log(sql);
  console.log("========== PARAMS ==========");
  console.log(params);
  console.log("========================");

  const [rows] = await conn.query(sql, params); // execute() এর বদলে query()

  return rows;
}
