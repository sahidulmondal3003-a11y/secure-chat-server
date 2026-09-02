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
 * Managed providers that require an encrypted connection and already
 * provision a default database for you (so CREATE DATABASE either isn't
 * needed or isn't permitted for the app's user).
 */
function isManagedTlsHost() {
  return (
    config.db.host.includes("aivencloud.com") ||
    config.db.host.includes("pscale.host") || // PlanetScale
    config.db.host.includes("psdb.cloud")
  );
}

/**
 * Build the mysql2 ssl option, if any.
 * - Explicit DB_SSL=true (or a known managed host) turns TLS on.
 * - A base64 CA cert (DB_CA_CERT_BASE64) enables full certificate
 *   verification; without it we still encrypt but skip verifying the
 *   server's certificate chain (fine to get started, less strict).
 */
function getSslOptions() {
  const wantsSsl = config.db.ssl || isManagedTlsHost();
  if (!wantsSsl) return undefined;

  if (config.db.caCertBase64) {
    return {
      ca: Buffer.from(config.db.caCertBase64, "base64").toString("utf8"),
      rejectUnauthorized: true,
    };
  }

  console.log("[DB] TLS enabled without a CA certificate (DB_CA_CERT_BASE64 not set) - connection is encrypted but the server certificate is not verified.");
  return { rejectUnauthorized: false };
}

/**
 * Create database only for local/self-hosted MySQL.
 * Railway and other managed providers (Aiven, PlanetScale, ...) already
 * create the database for you, and their app users often can't CREATE
 * DATABASE anyway.
 */
async function ensureDatabaseExists() {
  if (
    config.db.host.includes("railway.internal") ||
    config.db.host.includes("proxy.rlwy.net") ||
    isManagedTlsHost()
  ) {
    console.log("[DB] Managed provider detected. Skip CREATE DATABASE.");
    return;
  }

  const conn = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    ssl: getSslOptions(),
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

    ssl: getSslOptions(),

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
