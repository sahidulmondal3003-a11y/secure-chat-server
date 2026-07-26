const { query } = require('../db');
const { newId } = require('../utils/helpers');

async function createMessage({
  chatType,
  chatId,
  senderId,
  content,
  messageType = 'text',
  fileUrl = null,
  fileName = null,
  fileSize = null,
  replyToId = null,
}) {
  const id = newId();
  await query(
    `INSERT INTO messages
      (id, chat_type, chat_id, sender_id, reply_to_id, content, message_type, file_url, file_name, file_size)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, chatType, chatId, senderId, replyToId, content, messageType, fileUrl, fileName, fileSize]
  );
  return getMessageById(id);
}

async function getMessageById(id) {
  const rows = await query(
    `SELECT m.*, u.username as sender_username, u.display_name as sender_display_name, u.avatar_color as sender_avatar_color,
            r.content as reply_content, r.sender_id as reply_sender_id, ru.display_name as reply_sender_name
     FROM messages m
     JOIN users u ON u.id = m.sender_id
     LEFT JOIN messages r ON r.id = m.reply_to_id
     LEFT JOIN users ru ON ru.id = r.sender_id
     WHERE m.id = ? LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

async function listMessages(chatType, chatId, { limit = 30, before = null } = {}) {
  let sql = `
    SELECT m.*, u.username as sender_username, u.display_name as sender_display_name, u.avatar_color as sender_avatar_color,
           r.content as reply_content, r.sender_id as reply_sender_id, ru.display_name as reply_sender_name
    FROM messages m
    JOIN users u ON u.id = m.sender_id
    LEFT JOIN messages r ON r.id = m.reply_to_id
    LEFT JOIN users ru ON ru.id = r.sender_id
    WHERE m.chat_type = ? AND m.chat_id = ?`;
  const params = [chatType, chatId];

  if (before) {
    sql += ' AND m.created_at < ?';
    params.push(before);
  }

  sql += ' ORDER BY m.created_at DESC LIMIT ?';
  params.push(limit);

  const rows = await query(sql, params);
  return rows.reverse();
}

async function editMessage(messageId, senderId, newContent) {
  await query(
    `UPDATE messages SET content = ?, is_edited = 1 WHERE id = ? AND sender_id = ? AND is_deleted = 0`,
    [newContent, messageId, senderId]
  );
  return getMessageById(messageId);
}

async function deleteMessageForEveryone(messageId, requesterId, isAdmin = false) {
  const sql = isAdmin
    ? `UPDATE messages SET is_deleted = 1, deleted_for_everyone = 1, content = NULL, file_url = NULL WHERE id = ?`
    : `UPDATE messages SET is_deleted = 1, deleted_for_everyone = 1, content = NULL, file_url = NULL WHERE id = ? AND sender_id = ?`;
  const params = isAdmin ? [messageId] : [messageId, requesterId];
  await query(sql, params);
  return getMessageById(messageId);
}

async function markDelivered(messageId, userId) {
  await query(
    `INSERT INTO message_receipts (id, message_id, user_id, delivered_at)
     VALUES (?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE delivered_at = IFNULL(delivered_at, NOW())`,
    [newId(), messageId, userId]
  );
}

async function markSeen(messageId, userId) {
  await query(
    `INSERT INTO message_receipts (id, message_id, user_id, delivered_at, seen_at)
     VALUES (?, ?, ?, NOW(), NOW())
     ON DUPLICATE KEY UPDATE seen_at = NOW(), delivered_at = IFNULL(delivered_at, NOW())`,
    [newId(), messageId, userId]
  );
}

async function markAllSeenInChat(chatType, chatId, userId) {
  await query(
    `INSERT INTO message_receipts (id, message_id, user_id, delivered_at, seen_at)
     SELECT UUID(), m.id, ?, NOW(), NOW() FROM messages m
     WHERE m.chat_type = ? AND m.chat_id = ? AND m.sender_id != ? AND m.is_deleted = 0
     ON DUPLICATE KEY UPDATE seen_at = NOW(), delivered_at = IFNULL(delivered_at, NOW())`,
    [userId, chatType, chatId, userId]
  );
  await query(
    `UPDATE messages SET status = 'seen' WHERE chat_type = ? AND chat_id = ? AND sender_id != ?`,
    [chatType, chatId, userId]
  );
}

async function searchMessages(chatType, chatId, term, limit = 50) {
  return query(
    `SELECT m.*, u.display_name as sender_display_name
     FROM messages m JOIN users u ON u.id = m.sender_id
     WHERE m.chat_type = ? AND m.chat_id = ? AND m.is_deleted = 0 AND m.content LIKE ?
     ORDER BY m.created_at DESC LIMIT ?`,
    [chatType, chatId, `%${term}%`, limit]
  );
}

async function updateStatusForChat(chatType, chatId, status) {
  await query(`UPDATE messages SET status = ? WHERE chat_type = ? AND chat_id = ?`, [status, chatType, chatId]);
}

async function countMessages() {
  const rows = await query('SELECT COUNT(*) as total FROM messages');
  return rows[0].total;
}

async function deleteAllMessagesForChat(chatType, chatId) {
  await query('DELETE FROM messages WHERE chat_type = ? AND chat_id = ?', [chatType, chatId]);
}

module.exports = {
  createMessage,
  getMessageById,
  listMessages,
  editMessage,
  deleteMessageForEveryone,
  markDelivered,
  markSeen,
  markAllSeenInChat,
  searchMessages,
  updateStatusForChat,
  countMessages,
  deleteAllMessagesForChat,
};
