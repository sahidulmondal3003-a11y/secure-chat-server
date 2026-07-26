const bcrypt = require('bcrypt');
const { query } = require('../db');
const { newId, colorFromSeed } = require('../utils/helpers');
const config = require('../config');

async function createUser({ username, password, displayName, role = 'user' }) {
  const id = newId();
  const passwordHash = await bcrypt.hash(password, config.bcrypt.saltRounds);
  const avatarColor = colorFromSeed(username);

  await query(
    `INSERT INTO users (id, username, password_hash, display_name, avatar_color, role)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, username, passwordHash, displayName || username, avatarColor, role]
  );

  return findUserById(id);
}

async function findUserByUsername(username) {
  const rows = await query('SELECT * FROM users WHERE username = ? LIMIT 1', [username]);
  return rows[0] || null;
}

async function findUserById(id) {
  const rows = await query('SELECT * FROM users WHERE id = ? LIMIT 1', [id]);
  return rows[0] || null;
}

async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

async function setOnlineStatus(userId, isOnline) {
  await query(
    `UPDATE users SET is_online = ?, last_seen = CASE WHEN ? = 0 THEN NOW() ELSE last_seen END WHERE id = ?`,
    [isOnline ? 1 : 0, isOnline ? 1 : 0, userId]
  );
}

async function searchUsers(term, excludeUserId, limit = 20) {
  limit = Number(limit) || 20;

  return query(
    `SELECT
      id,
      username,
      display_name,
      avatar_color,
      is_online,
      last_seen
     FROM users
     WHERE username LIKE ?
       AND id != ?
       AND is_banned = 0
     ORDER BY username ASC
     LIMIT ${limit}`,
    [
      `%${term}%`,
      excludeUserId
    ]
  );
}

async function listAllUsers(limit = 100, offset = 0) {
  return query(
    `SELECT id, username, display_name, role, is_online, last_seen, is_banned, banned_reason, created_at
     FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [limit, offset]
  );
}

async function banUser(userId, reason) {
  await query('UPDATE users SET is_banned = 1, banned_reason = ? WHERE id = ?', [reason || 'Violation of terms', userId]);
}

async function unbanUser(userId) {
  await query('UPDATE users SET is_banned = 0, banned_reason = NULL WHERE id = ?', [userId]);
}

async function countUsers() {
  const rows = await query('SELECT COUNT(*) as total FROM users');
  return rows[0].total;
}

module.exports = {
  createUser,
  findUserByUsername,
  findUserById,
  verifyPassword,
  setOnlineStatus,
  searchUsers,
  listAllUsers,
  banUser,
  unbanUser,
  countUsers,
};
