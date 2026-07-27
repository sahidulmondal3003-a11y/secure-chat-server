/**
 * db.js
 * Railway + MySQL compatible
 */

const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");
const config = require("./config");

let pool;

/**
 * Create database only for local MySQL.
 * Railway already creates the database.
 */
async function ensureDatabaseExists() {
  if (
    config.db.host.includes("railway.internal") ||
    config.db.host.includes("proxy.rlwy.net")
  ) {
    console.log("[DB] Railway detected. Skip CREATE DATABASE.");
    return;
  }

  const conn = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
  });

  await conn.query(`
    CREATE DATABASE IF NOT EXISTS \`${config.db.database}\`
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci
  `);

  await conn.end();
}

/**
 * Run database.sql
 */
async function runSchema() {
  const schemaPath = path.join(__dirname, "database.sql");

  if (!fs.existsSync(schemaPath)) {
    throw new Error(`database.sql not found: ${schemaPath}`);
  }

  let sql = fs.readFileSync(schemaPath, "utf8");

  // Remove CREATE DATABASE + USE
  sql = sql.replace(
    /CREATE DATABASE[\s\S]*?;/gi,
    ""
  );

  sql = sql.replace(
    /USE\s+[`"]?.*?[`"]?\s*;/gi,
    ""
  );

  const statements = sql
    .split(/;\s*\n/)
    .map(s => s.replace(/--.*$/gm, "").trim())
    .filter(Boolean);

  const conn = await pool.getConnection();

  try {

    for (const stmt of statements) {

      try {

        await conn.query(stmt);

      } catch (err) {

        console.log("[Schema Skip]", err.message);

      }

    }

    console.log("[DB] Schema Ready");

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
    connectionLimit: config.db.connectionLimit || 10,
    queueLimit: 0,

    charset: "utf8mb4",
    dateStrings: true,

  });

  await pool.query("SELECT 1");

  console.log("[DB] Connected");

  await runSchema();

  return pool;

}

function getPool() {

  if (!pool) {

    throw new Error("Database not initialized.");

  }

  return pool;

}

async function query(sql, params = []) {

  const [rows] = await getPool().query(sql, params);

  return rows;

}

module.exports = {

  initDb,
  getPool,
  query,

};
