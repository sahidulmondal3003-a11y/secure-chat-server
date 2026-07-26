const userModel = require('../models/userModel');
const groupModel = require('../models/groupModel');
const messageModel = require('../models/messageModel');
const conversationModel = require('../models/conversationModel');
const { logActivity, listActivityLogs } = require('../models/logModel');

async function stats(req, res, next) {
  try {
    const [totalUsers, totalGroups, totalMessages] = await Promise.all([
      userModel.countUsers(),
      groupModel.countGroups(),
      messageModel.countMessages(),
    ]);
    res.json({ success: true, stats: { totalUsers, totalGroups, totalMessages } });
  } catch (err) {
    next(err);
  }
}

async function listUsers(req, res, next) {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const offset = parseInt(req.query.offset, 10) || 0;
    const users = await userModel.listAllUsers(limit, offset);
    res.json({ success: true, users });
  } catch (err) {
    next(err);
  }
}

async function listGroups(req, res, next) {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const offset = parseInt(req.query.offset, 10) || 0;
    const groups = await groupModel.listAllGroups(limit, offset);
    res.json({ success: true, groups });
  } catch (err) {
    next(err);
  }
}

async function banUser(req, res, next) {
  try {
    const { userId } = req.params;
    const { reason } = req.body;

    if (userId === req.user.id) {
      return res.status(400).json({ success: false, message: 'You cannot ban yourself.' });
    }

    await userModel.banUser(userId, reason);
    await logActivity(req.user.id, 'admin_ban_user', { userId, reason }, req.ip);
    res.json({ success: true, message: 'User has been banned.' });
  } catch (err) {
    next(err);
  }
}

async function unbanUser(req, res, next) {
  try {
    const { userId } = req.params;
    await userModel.unbanUser(userId);
    await logActivity(req.user.id, 'admin_unban_user', { userId }, req.ip);
    res.json({ success: true, message: 'User has been unbanned.' });
  } catch (err) {
    next(err);
  }
}

async function deleteGroup(req, res, next) {
  try {
    const { groupId } = req.params;
    await groupModel.softDeleteGroup(groupId);
    await messageModel.deleteAllMessagesForChat('group', groupId);
    await logActivity(req.user.id, 'admin_delete_group', { groupId }, req.ip);
    res.json({ success: true, message: 'Group deleted.' });
  } catch (err) {
    next(err);
  }
}

async function deleteConversation(req, res, next) {
  try {
    const { conversationId } = req.params;
    await messageModel.deleteAllMessagesForChat('private', conversationId);
    await logActivity(req.user.id, 'admin_delete_conversation', { conversationId }, req.ip);
    res.json({ success: true, message: 'Conversation messages deleted.' });
  } catch (err) {
    next(err);
  }
}

async function logs(req, res, next) {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const offset = parseInt(req.query.offset, 10) || 0;
    const action = req.query.action || null;
    const rows = await listActivityLogs(limit, offset, action);
    res.json({ success: true, logs: rows });
  } catch (err) {
    next(err);
  }
}

async function groupMessages(req, res, next) {
  try {
    const { groupId } = req.params;
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const messages = await messageModel.listMessages('group', groupId, { limit });
    res.json({ success: true, messages });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  stats,
  listUsers,
  listGroups,
  banUser,
  unbanUser,
  deleteGroup,
  deleteConversation,
  logs,
  groupMessages,
};
