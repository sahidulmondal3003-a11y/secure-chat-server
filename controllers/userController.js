const userModel = require('../models/userModel');
const conversationModel = require('../models/conversationModel');
const { getUnreadCounts } = require('../models/logModel');
const { sanitize } = require('../utils/helpers');

async function search(req, res, next) {
  try {
    const term = sanitize((req.query.q || '').trim());
    if (term.length < 1) return res.json({ success: true, users: [] });
    const users = await userModel.searchUsers(term, req.user.id);
    res.json({ success: true, users });
  } catch (err) {
    next(err);
  }
}

async function listConversations(req, res, next) {
  try {
    const conversations = await conversationModel.listUserConversations(req.user.id);
    const unread = await getUnreadCounts(req.user.id);
    res.json({ success: true, conversations, unread });
  } catch (err) {
    next(err);
  }
}

async function startConversation(req, res, next) {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(422).json({ success: false, message: 'userId is required.' });

    const target = await userModel.findUserById(userId);
    if (!target) return res.status(404).json({ success: false, message: 'User not found.' });

    const conversation = await conversationModel.findOrCreateConversation(req.user.id, userId);
    res.json({
      success: true,
      conversation: {
        id: conversation.id,
        otherUser: {
          id: target.id,
          username: target.username,
          displayName: target.display_name,
          avatarColor: target.avatar_color,
          isOnline: !!target.is_online,
          lastSeen: target.last_seen,
        },
      },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { search, listConversations, startConversation };
