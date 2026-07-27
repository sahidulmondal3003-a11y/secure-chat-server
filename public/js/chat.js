/**
 * chat.js - Secure Chat Server frontend application logic.
 * Handles auth bootstrap, socket.io real-time events, chat list rendering,
 * messaging (send/edit/delete/reply), typing indicators, presence,
 * file uploads, emoji picker, and message search.
 */

const EMOJIS = ['😀','😁','😂','🤣','😊','😍','😘','😜','🤔','😎','😢','😭','😡','👍','👎','🙏','👏','🔥','🎉','❤️','💯','😴','🥳','😇','🤗','😅','🙌','👀','💪','✅'];

let me = null;
let socket = null;
let activeChat = null; // { type: 'private'|'group', id, name, avatarColor, sub }
let typingTimeout = null;
let typingUsers = new Map(); // userId -> displayName, per active chat
let replyTarget = null;
let editTarget = null;
let conversationsCache = [];
let groupsCache = [];
let onlineStatusCache = new Map();
let messagesRendered = new Map(); // messageId -> DOM element, for current open chat
let pendingAvatarUrl; // undefined = no change staged, null = remove picture, string = newly uploaded url

// ============================================================
// BOOTSTRAP
// ============================================================
async function bootstrap() {
  try {
    const res = await Api.get('/api/auth/me');
    me = res.user;
  } catch (err) {
    window.location.href = '/';
    return;
  }

  document.getElementById('meName').textContent = me.displayName;
  document.getElementById('meRole').textContent = me.role === 'admin' ? 'Administrator' : 'Online';
  applyAvatar(document.getElementById('meAvatar'), { url: me.avatarUrl, color: me.avatarColor, name: me.displayName });
  if (me.role === 'admin') document.getElementById('adminLink').style.display = 'flex';

  requestNotificationPermission();
  connectSocket();
  await loadConversations();
  await loadGroups();
  bindGlobalUI();
}

function connectSocket() {
  const token = localStorage.getItem('scs_access_token');
  socket = io({ withCredentials: true, auth: { token } });

  socket.on('connect', () => console.log('[socket] connected'));
  socket.on('connect_error', (err) => {
    console.error('[socket] connect error', err.message);
    if (err.message.includes('Authentication') || err.message.includes('token')) {
      window.location.href = '/';
    }
  });

  socket.on('message:new', onIncomingMessage);
  socket.on('message:edited', onMessageEdited);
  socket.on('message:deleted', onMessageDeleted);
  socket.on('message:status', onMessageStatus);
  socket.on('chat:seen', onChatSeen);
  socket.on('typing:update', onTypingUpdate);
  socket.on('presence:update', onPresenceUpdate);
  socket.on('notification:new', onNotification);
  socket.on('group:member-joined', () => loadGroups());
  socket.on('group:member-left', () => loadGroups());
}

async function logout() {
  try {
    await Api.post('/api/auth/logout');
  } catch (e) { /* ignore */ }
  localStorage.removeItem('scs_user');
  localStorage.removeItem('scs_access_token');
  window.location.href = '/';
}

// ============================================================
// MY PROFILE: nickname + profile picture
// ============================================================
function openProfileModal() {
  document.getElementById('profileDisplayName').value = me.displayName;
  document.getElementById('profileFormError').textContent = '';
  pendingAvatarUrl = undefined;
  applyAvatar(document.getElementById('profileAvatarPreview'), { url: me.avatarUrl, color: me.avatarColor, name: me.displayName });
  document.getElementById('profileAvatarRemove').classList.toggle('hidden', !me.avatarUrl);
  openModal('profileModal');
}

async function handleProfileAvatarSelected(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    Toast.error('Please choose an image file.');
    return;
  }
  const maxMb = 8;
  if (file.size > maxMb * 1024 * 1024) {
    Toast.error(`Image too large. Max ${maxMb}MB.`);
    return;
  }

  const formData = new FormData();
  formData.append('file', file);

  Toast.info('Uploading picture...');
  try {
    const res = await Api.post('/api/uploads', formData);
    pendingAvatarUrl = res.file.url;
    applyAvatar(document.getElementById('profileAvatarPreview'), { url: pendingAvatarUrl, color: me.avatarColor, name: me.displayName });
    document.getElementById('profileAvatarRemove').classList.remove('hidden');
  } catch (err) {
    Toast.error(err.data?.message || err.message || 'Upload failed.');
  }
}

function removeProfileAvatar() {
  pendingAvatarUrl = null;
  applyAvatar(document.getElementById('profileAvatarPreview'), { url: null, color: me.avatarColor, name: me.displayName });
  document.getElementById('profileAvatarRemove').classList.add('hidden');
}

async function saveProfile(e) {
  e.preventDefault();
  const errorEl = document.getElementById('profileFormError');
  errorEl.textContent = '';

  const displayName = document.getElementById('profileDisplayName').value.trim();
  const body = { displayName };
  if (pendingAvatarUrl !== undefined) body.avatarUrl = pendingAvatarUrl;

  try {
    const res = await Api.put('/api/users/me', body);
    me = { ...me, ...res.user };
    document.getElementById('meName').textContent = me.displayName;
    applyAvatar(document.getElementById('meAvatar'), { url: me.avatarUrl, color: me.avatarColor, name: me.displayName });
    closeModal('profileModal');
    Toast.success('Profile updated.');
    await loadConversations();
    await loadGroups();
  } catch (err) {
    errorEl.textContent = err.data?.message || err.message || 'Failed to update profile.';
  }
}

document.addEventListener('DOMContentLoaded', bootstrap);

// ============================================================
// SIDEBAR: CHAT LIST / GROUP LIST
// ============================================================
function switchSidebarTab(tab) {
  document.querySelectorAll('.sidebar-tab').forEach((el) => el.classList.toggle('active', el.dataset.tab === tab));
  document.getElementById('chatListChats').classList.toggle('hidden', tab !== 'chats');
  document.getElementById('chatListGroups').classList.toggle('hidden', tab !== 'groups');
}

async function loadConversations() {
  const res = await Api.get('/api/users/conversations');
  conversationsCache = res.conversations;
  const unreadMap = {};
  (res.unread || []).forEach((u) => {
    unreadMap[`${u.chat_type}:${u.chat_id}`] = u.count;
  });
  renderChatList(unreadMap);
}

function renderChatList(unreadMap = {}) {
  const container = document.getElementById('chatListChats');
  if (conversationsCache.length === 0) {
    container.innerHTML = `<div class="empty-state">No conversations yet.<br>Tap + to start a private chat.</div>`;
    return;
  }
  container.innerHTML = '';
  conversationsCache.forEach((c) => {
    const unread = unreadMap[`private:${c.id}`] || 0;
    const item = document.createElement('div');
    item.className = 'chat-item';
    item.dataset.chatId = c.id;
    item.dataset.chatType = 'private';
    item.innerHTML = `
      <div class="avatar" style="${avatarStyle(c.other_avatar_color, c.other_avatar_url)}">
        ${avatarGlyph(c.other_avatar_url, c.other_display_name, false)}
        <span class="status-dot ${c.other_is_online ? 'online' : ''}"></span>
      </div>
      <div class="chat-item-body">
        <div class="chat-item-top">
          <span class="chat-item-name">${escapeHtml(c.other_display_name)}</span>
        </div>
        <div class="chat-item-preview">@${escapeHtml(c.other_username)} ${c.other_is_online ? '· online' : c.other_last_seen ? '· seen ' + timeAgo(c.other_last_seen) : ''}</div>
      </div>
      ${unread > 0 ? `<span class="unread-badge">${unread > 99 ? '99+' : unread}</span>` : ''}
    `;
    item.onclick = () => openChat('private', c.id, {
      name: c.other_display_name,
      sub: c.other_is_online ? 'online' : (c.other_last_seen ? 'last seen ' + timeAgo(c.other_last_seen) : 'offline'),
      avatarColor: c.other_avatar_color,
      avatarUrl: c.other_avatar_url,
      otherUserId: c.other_user_id,
    });
    container.appendChild(item);
  });
}

async function loadGroups() {
  const res = await Api.get('/api/groups/mine');
  groupsCache = res.groups;
  renderGroupList();
}

function renderGroupList() {
  const container = document.getElementById('chatListGroups');
  if (groupsCache.length === 0) {
    container.innerHTML = `<div class="empty-state">No groups yet.<br>Tap + to create or join one.</div>`;
    return;
  }
  container.innerHTML = '';
  groupsCache.forEach((g) => {
    const item = document.createElement('div');
    item.className = 'chat-item';
    item.dataset.chatId = g.id;
    item.dataset.chatType = 'group';
    item.innerHTML = `
      <div class="avatar" style="background:${g.avatar_color}">👥</div>
      <div class="chat-item-body">
        <div class="chat-item-top"><span class="chat-item-name">${escapeHtml(g.name)}</span></div>
        <div class="chat-item-preview">${escapeHtml(g.description || 'Group chat')}</div>
      </div>
    `;
    item.onclick = () => openChat('group', g.id, { name: g.name, sub: 'Group', avatarColor: g.avatar_color });
    container.appendChild(item);
  });
}

function markActiveInList(chatId) {
  document.querySelectorAll('.chat-item').forEach((el) => {
    el.classList.toggle('active', el.dataset.chatId === chatId);
  });
}

// ============================================================
// OPEN A CHAT
// ============================================================
let chatHistoryPushed = false; // tracks whether we've pushed a history entry for the open chat view

async function openChat(chatType, chatId, meta) {
  if (activeChat) {
    socket.emit('chat:leave', { chatType: activeChat.type, chatId: activeChat.id });
  }
  activeChat = { type: chatType, id: chatId, ...meta };
  markActiveInList(chatId);

  // Push a history entry the first time we enter chat view, so the browser/
  // hardware back button (and mobile swipe-back gesture) closes the chat
  // instead of leaving the app.
  if (!chatHistoryPushed) {
    history.pushState({ scsChatOpen: true }, '');
    chatHistoryPushed = true;
  }

  document.getElementById('chatApp').classList.remove('view-list');
  document.getElementById('chatApp').classList.add('view-chat');
  document.getElementById('welcomePane').style.display = 'none';
  document.getElementById('activeChatArea').classList.remove('hidden');
  document.getElementById('activeChatArea').style.display = 'flex';

  applyAvatar(document.getElementById('chatHeaderAvatar'), {
    url: chatType === 'group' ? null : meta.avatarUrl,
    color: meta.avatarColor,
    name: meta.name,
    isGroup: chatType === 'group',
  });
  document.getElementById('chatHeaderName').textContent = meta.name;
  document.getElementById('chatHeaderSub').textContent = meta.sub || '';

  document.getElementById('msgSearchBar').classList.add('hidden');
  document.getElementById('msgSearchResults').classList.add('hidden');
  cancelReply();
  cancelEdit();
  document.getElementById('typingIndicator').innerHTML = '';
  typingUsers.clear();

  socket.emit('chat:join', { chatType, chatId });

  const messagesArea = document.getElementById('messagesArea');
  messagesArea.innerHTML = '<div class="empty-state">Loading messages...</div>';
  messagesRendered.clear();

  try {
    const res = await Api.get(`/api/messages/${chatType}/${chatId}/history?limit=40`);
    messagesArea.innerHTML = '';
    let lastDate = null;
    res.messages.forEach((m) => {
      const dateLabel = formatDateLabel(m.created_at);
      if (dateLabel !== lastDate) {
        appendDateSeparator(dateLabel);
        lastDate = dateLabel;
      }
      appendMessage(m, false);
    });
    scrollToBottom();
    socket.emit('chat:seen', { chatType, chatId });
    await loadConversations();
    if (chatType === 'group') await loadGroups();
  } catch (err) {
    messagesArea.innerHTML = `<div class="empty-state">Failed to load messages.</div>`;
    Toast.error(err.message);
  }
}

// Actually reverts the UI from chat view back to the list. Does NOT touch
// browser history itself — call backToList()/exitChat() instead if the
// action originates from a user click, so history stays in sync.
function closeChatView() {
  document.getElementById('chatApp').classList.remove('view-chat');
  document.getElementById('chatApp').classList.add('view-list');
  markActiveInList(null);
}

// Exit the currently open chat and return to the chat list.
// If we pushed a history entry when opening the chat, go back through it
// (this fires the popstate handler below, which does the actual UI revert).
// Otherwise (e.g. no history entry yet) just revert the UI directly.
function backToList() {
  if (chatHistoryPushed && history.state && history.state.scsChatOpen) {
    history.back();
  } else {
    closeChatView();
  }
}

// Alias with a clearer name for the "exit chat" action.
function exitChat() {
  backToList();
}

// Hardware/browser back button (and swipe-back gestures on mobile) should
// close an open chat instead of navigating away from the app or exiting.
window.addEventListener('popstate', () => {
  chatHistoryPushed = false;
  if (document.getElementById('chatApp').classList.contains('view-chat')) {
    closeChatView();
  }
});

// Desktop convenience: Escape key exits the open chat too.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.getElementById('chatApp').classList.contains('view-chat')) {
    const activeModal = document.querySelector('.modal-overlay:not(.hidden)');
    if (activeModal) return; // let modal close logic handle Escape first
    backToList();
  }
});

function appendDateSeparator(label) {
  const div = document.createElement('div');
  div.className = 'date-sep';
  div.innerHTML = `<span>${label}</span>`;
  document.getElementById('messagesArea').appendChild(div);
}

function scrollToBottom() {
  const area = document.getElementById('messagesArea');
  area.scrollTop = area.scrollHeight;
}

// ============================================================
// RENDER A SINGLE MESSAGE
// ============================================================
function buildTicks(msg) {
  if (msg.sender_id !== me.id) return '';
  let icon = '✓';
  let color = 'inherit';
  if (msg.status === 'delivered') icon = '✓✓';
  if (msg.status === 'seen') { icon = '✓✓'; color = '#22d3ee'; }
  return `<span class="msg-ticks" style="color:${color}">${icon}</span>`;
}

function fileIconFor(type) {
  return { image: '🖼️', video: '🎬', audio: '🎵', pdf: '📄', zip: '🗜️', apk: '📱', file: '📎' }[type] || '📎';
}

function renderMessageBody(m) {
  if (m.is_deleted) {
    return `<div class="msg-deleted">🚫 This message was deleted</div>`;
  }
  let replyHtml = '';
  if (m.reply_to_id && m.reply_content !== null && m.reply_content !== undefined) {
    replyHtml = `<div class="msg-reply-ref"><b>${escapeHtml(m.reply_sender_name || '')}</b><br>${escapeHtml((m.reply_content || '').slice(0, 80))}</div>`;
  } else if (m.reply_to_id) {
    replyHtml = `<div class="msg-reply-ref"><i>Original message unavailable</i></div>`;
  }

  if (m.message_type === 'text' || !m.message_type) {
    return `${replyHtml}<div>${escapeHtml(m.content)}</div>`;
  }
  if (m.message_type === 'image') {
    return `${replyHtml}<img class="msg-image" src="${m.file_url}" onclick="openMedia('image','${m.file_url}')" loading="lazy">`;
  }
  if (m.message_type === 'video') {
    return `${replyHtml}<video class="msg-video" src="${m.file_url}" controls></video>`;
  }
  if (m.message_type === 'audio') {
    return `${replyHtml}<audio class="msg-audio" src="${m.file_url}" controls></audio>`;
  }
  // pdf, zip, apk, file
  return `${replyHtml}<a href="${m.file_url}" download="${escapeHtml(m.file_name || '')}" style="color:inherit;text-decoration:none;">
    <div class="msg-file">
      <div class="msg-file-icon">${fileIconFor(m.message_type)}</div>
      <div class="msg-file-info">
        <div class="msg-file-name">${escapeHtml(m.file_name || 'File')}</div>
        <div class="msg-file-size">${formatFileSize(m.file_size)} · Tap to download</div>
      </div>
    </div>
  </a>`;
}

function appendMessage(m, animate = true, prepend = false) {
  const area = document.getElementById('messagesArea');
  const mine = m.sender_id === me.id;

  const row = document.createElement('div');
  row.className = `msg-row ${mine ? 'mine' : 'theirs'}`;
  row.dataset.messageId = m.id;
  if (!animate) row.style.animation = 'none';

  const showSenderName = activeChat.type === 'group' && !mine;

  const actionsHtml = !m.is_deleted ? `
    <div class="msg-actions">
      <button onclick="startReply('${m.id}')" title="Reply">↩️</button>
      ${mine && m.message_type === 'text' ? `<button onclick="startEdit('${m.id}')" title="Edit">✏️</button>` : ''}
      ${(mine || me.role === 'admin') ? `<button onclick="deleteMessage('${m.id}', true)" title="Delete for everyone">🗑️</button>` : ''}
    </div>` : '';

  row.innerHTML = `
    ${mine ? actionsHtml : ''}
    <div class="msg-bubble-wrap">
      ${showSenderName ? `<div class="msg-sender-name">${escapeHtml(m.sender_display_name)}</div>` : ''}
      <div class="msg-bubble">
        ${renderMessageBody(m)}
        ${!m.is_deleted ? `<div class="msg-meta">
          ${m.is_edited ? '<span class="msg-edited-tag">edited</span>' : ''}
          <span>${formatClock(m.created_at)}</span>
          ${buildTicks(m)}
        </div>` : ''}
      </div>
    </div>
    ${!mine ? actionsHtml : ''}
  `;

  if (prepend) area.insertBefore(row, area.firstChild);
  else area.appendChild(row);

  messagesRendered.set(m.id, row);

  if (mine === false) {
    socket.emit('message:delivered', { messageId: m.id, chatType: activeChat.type, chatId: activeChat.id });
  }
}

function onIncomingMessage(m) {
  const belongsToActive = activeChat && activeChat.type === m.chat_type && activeChat.id === m.chat_id;
  if (belongsToActive) {
    appendMessage(m);
    scrollToBottom();
    if (m.sender_id !== me.id) {
      socket.emit('chat:seen', { chatType: activeChat.type, chatId: activeChat.id });
    }
  }
  loadConversations();
  if (m.chat_type === 'group') loadGroups();
}

function onMessageEdited(m) {
  const row = messagesRendered.get(m.id);
  if (row) {
    const bubble = row.querySelector('.msg-bubble');
    bubble.innerHTML = `${renderMessageBody(m)}<div class="msg-meta"><span class="msg-edited-tag">edited</span><span>${formatClock(m.created_at)}</span>${buildTicks(m)}</div>`;
  }
}

function onMessageDeleted({ messageId, message }) {
  const row = messagesRendered.get(messageId);
  if (row) {
    const bubble = row.querySelector('.msg-bubble');
    bubble.innerHTML = `<div class="msg-deleted">🚫 This message was deleted</div>`;
    row.querySelectorAll('.msg-actions').forEach((el) => el.remove());
  }
}

function onMessageStatus({ messageId, status }) {
  const row = messagesRendered.get(messageId);
  if (!row) return;
  const ticks = row.querySelector('.msg-ticks');
  if (ticks && status === 'delivered') ticks.textContent = '✓✓';
}

function onChatSeen({ chatType, chatId }) {
  if (!activeChat || activeChat.type !== chatType || activeChat.id !== chatId) return;
  messagesRendered.forEach((row, id) => {
    if (row.classList.contains('mine')) {
      const ticks = row.querySelector('.msg-ticks');
      if (ticks) { ticks.textContent = '✓✓'; ticks.style.color = '#22d3ee'; }
    }
  });
}

// ============================================================
// COMPOSER: send / reply / edit / typing
// ============================================================
function startReply(messageId) {
  const row = messagesRendered.get(messageId);
  if (!row) return;
  const bubbleText = row.querySelector('.msg-bubble div')?.textContent || '[Attachment]';
  const senderName = row.classList.contains('mine') ? 'yourself' : (row.querySelector('.msg-sender-name')?.textContent || activeChat.name);
  replyTarget = { id: messageId, text: bubbleText, sender: senderName };
  document.getElementById('replyToName').textContent = senderName;
  document.getElementById('replyPreviewText').textContent = bubbleText;
  document.getElementById('replyPreview').classList.remove('hidden');
  cancelEdit();
  document.getElementById('composerInput').focus();
}
function cancelReply() {
  replyTarget = null;
  document.getElementById('replyPreview').classList.add('hidden');
}

function startEdit(messageId) {
  const row = messagesRendered.get(messageId);
  if (!row) return;
  const text = row.querySelector('.msg-bubble div')?.textContent || '';
  editTarget = messageId;
  const input = document.getElementById('composerInput');
  input.value = text;
  input.focus();
  document.getElementById('editPreview').classList.remove('hidden');
  cancelReply();
  updateSendBtn();
}
function cancelEdit() {
  editTarget = null;
  document.getElementById('editPreview').classList.add('hidden');
}

function deleteMessage(messageId, forEveryone) {
  if (!confirm('Delete this message for everyone?')) return;
  socket.emit('message:delete', { messageId, chatType: activeChat.type, chatId: activeChat.id, forEveryone }, (ack) => {
    if (!ack.success) Toast.error(ack.message || 'Failed to delete message.');
  });
}

function updateSendBtn() {
  const val = document.getElementById('composerInput').value.trim();
  document.getElementById('sendBtn').disabled = val.length === 0;
}

function sendTextMessage() {
  const input = document.getElementById('composerInput');
  const content = input.value.trim();
  if (!content || !activeChat) return;

  if (editTarget) {
    socket.emit('message:edit', { messageId: editTarget, chatType: activeChat.type, chatId: activeChat.id, content }, (ack) => {
      if (!ack.success) Toast.error(ack.message || 'Failed to edit message.');
    });
    cancelEdit();
  } else {
    socket.emit('message:send', {
      chatType: activeChat.type,
      chatId: activeChat.id,
      content,
      messageType: 'text',
      replyToId: replyTarget ? replyTarget.id : null,
    }, (ack) => {
      if (!ack.success) Toast.error(ack.message || 'Failed to send message.');
    });
    cancelReply();
  }

  input.value = '';
  input.style.height = 'auto';
  updateSendBtn();
  stopTyping();
}

function notifyTyping() {
  if (!activeChat) return;
  socket.emit('typing:start', { chatType: activeChat.type, chatId: activeChat.id });
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(stopTyping, 2000);
}
function stopTyping() {
  if (!activeChat) return;
  clearTimeout(typingTimeout);
  socket.emit('typing:stop', { chatType: activeChat.type, chatId: activeChat.id });
}

function onTypingUpdate({ chatType, chatId, userId, displayName, isTyping }) {
  if (!activeChat || activeChat.type !== chatType || activeChat.id !== chatId) return;
  if (isTyping) typingUsers.set(userId, displayName);
  else typingUsers.delete(userId);

  const el = document.getElementById('typingIndicator');
  if (typingUsers.size === 0) {
    el.innerHTML = '';
    return;
  }
  const names = Array.from(typingUsers.values()).slice(0, 2).join(', ');
  el.innerHTML = `<span>${escapeHtml(names)} typing</span><span class="typing-dots"><span></span><span></span><span></span></span>`;
}

function onPresenceUpdate({ userId, isOnline, lastSeen }) {
  onlineStatusCache.set(userId, { isOnline, lastSeen });
  if (activeChat && activeChat.type === 'private' && activeChat.otherUserId === userId) {
    document.getElementById('chatHeaderSub').textContent = isOnline ? 'online' : (lastSeen ? 'last seen ' + timeAgo(lastSeen) : 'offline');
  }
  loadConversations();
}

function onNotification({ chatType, chatId, from, preview }) {
  const isActiveChat = activeChat && activeChat.type === chatType && activeChat.id === chatId;
  if (!isActiveChat) {
    showBrowserNotification(from, preview);
    Toast.info(`${from}: ${preview}`);
  }
  loadConversations();
  if (chatType === 'group') loadGroups();
}

// ============================================================
// EMOJI PICKER
// ============================================================
function buildEmojiPanel() {
  const panel = document.getElementById('emojiPanel');
  panel.innerHTML = EMOJIS.map((e) => `<button type="button" onclick="insertEmoji('${e}')">${e}</button>`).join('');
}
function insertEmoji(emoji) {
  const input = document.getElementById('composerInput');
  input.value += emoji;
  input.focus();
  updateSendBtn();
}
function toggleEmojiPanel() {
  document.getElementById('emojiPanel').classList.toggle('hidden');
}

// ============================================================
// FILE UPLOAD
// ============================================================
async function handleFileSelected(file) {
  if (!file || !activeChat) return;
  const maxMb = 50;
  if (file.size > maxMb * 1024 * 1024) {
    Toast.error(`File too large. Max ${maxMb}MB.`);
    return;
  }

  const formData = new FormData();
  formData.append('file', file);

  Toast.info('Uploading file...');
  try {
    const res = await Api.post('/api/uploads', formData);
    socket.emit('message:send', {
      chatType: activeChat.type,
      chatId: activeChat.id,
      messageType: res.file.type,
      content: res.file.name,
      fileUrl: res.file.url,
      fileName: res.file.name,
      fileSize: res.file.size,
      replyToId: replyTarget ? replyTarget.id : null,
    }, (ack) => {
      if (!ack.success) Toast.error(ack.message || 'Failed to send file.');
    });
    cancelReply();
  } catch (err) {
    Toast.error(err.data?.message || err.message || 'Upload failed.');
  }
}

function openMedia(type, url) {
  const modal = document.getElementById('mediaModal');
  const content = document.getElementById('mediaModalContent');
  if (type === 'image') {
    content.innerHTML = `<img src="${url}" style="max-width:100%;max-height:88vh;border-radius:12px;">`;
  }
  modal.classList.remove('hidden');
}

// ============================================================
// MODAL HELPERS
// ============================================================
function openModal(id) { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

function switchNewTab(tab) {
  document.getElementById('newTabChat').classList.toggle('active', tab === 'chat');
  document.getElementById('newTabGroup').classList.toggle('active', tab === 'group');
  document.getElementById('newChatPane').classList.toggle('hidden', tab !== 'chat');
  document.getElementById('newGroupPane').classList.toggle('hidden', tab !== 'group');
}
function switchGroupTab(tab) {
  document.getElementById('grpTabCreate').classList.toggle('active', tab === 'create');
  document.getElementById('grpTabJoin').classList.toggle('active', tab === 'join');
  document.getElementById('createGroupForm').classList.toggle('hidden', tab !== 'create');
  document.getElementById('joinGroupForm').classList.toggle('hidden', tab !== 'join');
}

// ---- Search users for new private chat ----
let userSearchDebounce = null;
function bindNewChatSearch() {
  document.getElementById('newChatSearch').addEventListener('input', (e) => {
    clearTimeout(userSearchDebounce);
    const term = e.target.value.trim();
    const resultsEl = document.getElementById('newChatResults');
    if (term.length < 1) { resultsEl.innerHTML = ''; return; }
    userSearchDebounce = setTimeout(async () => {
      const res = await Api.get(`/api/users/search?q=${encodeURIComponent(term)}`);
      resultsEl.innerHTML = res.users.length
        ? res.users.map((u) => `
          <div class="member-row" onclick="startPrivateChat('${u.id}')">
            <div class="avatar sm" style="${avatarStyle(u.avatar_color, u.avatar_url)}">${avatarGlyph(u.avatar_url, u.display_name, false)}</div>
            <div>
              <div style="font-weight:600;font-size:13.5px;">${escapeHtml(u.display_name)}</div>
              <div style="font-size:12px;color:var(--text-secondary);">@${escapeHtml(u.username)}</div>
            </div>
          </div>`).join('')
        : `<div class="empty-state">No users found.</div>`;
    }, 300);
  });
}

async function startPrivateChat(userId) {
  const res = await Api.post('/api/users/conversations/start', { userId });
  closeModal('newModal');
  await loadConversations();
  switchSidebarTab('chats');
  const ou = res.conversation.otherUser;
  openChat('private', res.conversation.id, {
    name: ou.displayName,
    sub: ou.isOnline ? 'online' : 'offline',
    avatarColor: ou.avatarColor,
    avatarUrl: ou.avatarUrl,
    otherUserId: ou.id,
  });
}

// ---- Global sidebar search (people + groups combined) ----
let sidebarSearchDebounce = null;
function bindSidebarSearch() {
  const input = document.getElementById('userSearchInput');
  const panel = document.getElementById('searchResultsPanel');
  input.addEventListener('input', () => {
    clearTimeout(sidebarSearchDebounce);
    const term = input.value.trim();
    if (term.length < 1) { panel.classList.add('hidden'); return; }
    sidebarSearchDebounce = setTimeout(async () => {
      const res = await Api.get(`/api/users/search?q=${encodeURIComponent(term)}`);
      panel.classList.remove('hidden');
      panel.innerHTML = res.users.length
        ? res.users.map((u) => `
          <div class="search-hit" onclick="startPrivateChat('${u.id}'); document.getElementById('searchResultsPanel').classList.add('hidden'); document.getElementById('userSearchInput').value='';">
            <div class="search-hit-name">@${escapeHtml(u.username)}</div>
            <div class="search-hit-text">${escapeHtml(u.display_name)}</div>
          </div>`).join('')
        : `<div class="empty-state">No matches.</div>`;
    }, 300);
  });
  document.addEventListener('click', (e) => {
    if (!panel.contains(e.target) && e.target !== input) panel.classList.add('hidden');
  });
}

// ---- In-chat message search ----
function toggleMsgSearch() {
  const bar = document.getElementById('msgSearchBar');
  bar.classList.toggle('hidden');
  if (!bar.classList.contains('hidden')) document.getElementById('msgSearchInput').focus();
  else document.getElementById('msgSearchResults').classList.add('hidden');
}
let msgSearchDebounce = null;
function bindMsgSearch() {
  document.getElementById('msgSearchInput').addEventListener('input', (e) => {
    clearTimeout(msgSearchDebounce);
    const term = e.target.value.trim();
    const panel = document.getElementById('msgSearchResults');
    if (term.length < 1 || !activeChat) { panel.classList.add('hidden'); return; }
    msgSearchDebounce = setTimeout(async () => {
      const res = await Api.get(`/api/messages/${activeChat.type}/${activeChat.id}/search?q=${encodeURIComponent(term)}`);
      panel.classList.remove('hidden');
      panel.innerHTML = res.messages.length
        ? res.messages.map((m) => `
          <div class="search-hit" onclick="jumpToMessage('${m.id}')">
            <div class="search-hit-name">${escapeHtml(m.sender_display_name)} · ${formatClock(m.created_at)}</div>
            <div class="search-hit-text">${escapeHtml((m.content || '').slice(0, 100))}</div>
          </div>`).join('')
        : `<div class="empty-state">No messages found.</div>`;
    }, 300);
  });
}
function jumpToMessage(messageId) {
  const row = messagesRendered.get(messageId);
  if (row) {
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    row.style.outline = '2px solid var(--accent)';
    setTimeout(() => (row.style.outline = 'none'), 1500);
  }
  document.getElementById('msgSearchResults').classList.add('hidden');
}

// ---- Info modal (group members / private chat info) ----
async function openInfoModal() {
  if (!activeChat) return;
  const body = document.getElementById('infoModalBody');

  if (activeChat.type === 'private') {
    body.innerHTML = `
      <div style="text-align:center;padding:10px 0 20px;">
        <div class="avatar" style="width:76px;height:76px;font-size:26px;margin:0 auto 12px;${avatarStyle(activeChat.avatarColor, activeChat.avatarUrl)}">${avatarGlyph(activeChat.avatarUrl, activeChat.name, false)}</div>
        <div style="font-weight:700;font-size:17px;">${escapeHtml(activeChat.name)}</div>
        <div style="color:var(--text-secondary);font-size:13px;margin-top:4px;">${escapeHtml(activeChat.sub)}</div>
      </div>`;
  } else {
    body.innerHTML = `<div class="empty-state">Loading members...</div>`;
    const res = await Api.get(`/api/groups/${activeChat.id}/members`);
    body.innerHTML = `
      <div style="text-align:center;margin-bottom:14px;">
        <div class="avatar" style="width:70px;height:70px;font-size:24px;margin:0 auto 10px;background:${activeChat.avatarColor}">👥</div>
        <div style="font-weight:700;font-size:16px;">${escapeHtml(activeChat.name)}</div>
        <div style="color:var(--text-secondary);font-size:12.5px;">${res.members.length} members</div>
      </div>
      <div style="max-height:280px;overflow-y:auto;">
        ${res.members.map((m) => `
          <div class="member-row">
            <div class="avatar sm" style="${avatarStyle(m.avatar_color, m.avatar_url)}">
              ${avatarGlyph(m.avatar_url, m.display_name, false)}
              <span class="status-dot ${m.is_online ? 'online' : ''}"></span>
            </div>
            <div style="flex:1;">
              <div style="font-weight:600;font-size:13.5px;">${escapeHtml(m.display_name)} ${m.id === me.id ? '(you)' : ''}</div>
              <div style="font-size:11.5px;color:var(--text-secondary);">${m.role} · ${m.is_online ? 'online' : timeAgo(m.last_seen)}</div>
            </div>
          </div>`).join('')}
      </div>
      <button class="btn btn-danger" style="width:100%;margin-top:16px;" onclick="leaveCurrentGroup()">Leave Group</button>
    `;
  }
  openModal('infoModal');
}

async function leaveCurrentGroup() {
  if (!activeChat || activeChat.type !== 'group') return;
  if (!confirm('Leave this group?')) return;
  await Api.post(`/api/groups/${activeChat.id}/leave`);
  socket.emit('group:left', { groupId: activeChat.id });
  closeModal('infoModal');
  backToList();
  activeChat = null;
  document.getElementById('welcomePane').style.display = 'flex';
  document.getElementById('activeChatArea').classList.add('hidden');
  document.getElementById('activeChatArea').style.display = 'none';
  await loadGroups();
}

// ============================================================
// GLOBAL UI BINDINGS
// ============================================================
function bindGlobalUI() {
  buildEmojiPanel();
  bindNewChatSearch();
  bindSidebarSearch();
  bindMsgSearch();

  document.getElementById('fabNew').addEventListener('click', () => {
    document.getElementById('newChatSearch').value = '';
    document.getElementById('newChatResults').innerHTML = '';
    switchNewTab('chat');
    openModal('newModal');
  });

  document.getElementById('profileForm').addEventListener('submit', saveProfile);
  document.getElementById('profileAvatarInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    handleProfileAvatarSelected(file);
    e.target.value = '';
  });

  const composer = document.getElementById('composerInput');
  composer.addEventListener('input', () => {
    updateSendBtn();
    notifyTyping();
    composer.style.height = 'auto';
    composer.style.height = Math.min(composer.scrollHeight, 120) + 'px';
  });
  composer.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendTextMessage();
    }
  });

  document.getElementById('sendBtn').addEventListener('click', sendTextMessage);
  document.getElementById('emojiBtn').addEventListener('click', toggleEmojiPanel);
  document.getElementById('attachBtn').addEventListener('click', () => document.getElementById('fileInput').click());
  document.getElementById('fileInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    handleFileSelected(file);
    e.target.value = '';
  });

  document.getElementById('createGroupForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('createGroupError');
    errorEl.textContent = '';
    try {
      const name = document.getElementById('grpName').value.trim();
      const description = document.getElementById('grpDesc').value.trim();
      const password = document.getElementById('grpPassword').value;
      const res = await Api.post('/api/groups/create', { name, description, password });
      Toast.success('Group created!');
      closeModal('newModal');
      e.target.reset();
      await loadGroups();
      switchSidebarTab('groups');
      socket.emit('group:joined', { groupId: res.group.id });
      openChat('group', res.group.id, { name: res.group.name, sub: 'Group · you are the owner', avatarColor: res.group.avatarColor });
    } catch (err) {
      errorEl.textContent = err.data?.message || err.message;
    }
  });

  document.getElementById('joinGroupForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('joinGroupError');
    errorEl.textContent = '';
    try {
      const name = document.getElementById('joinGrpName').value.trim();
      const password = document.getElementById('joinGrpPassword').value;
      const res = await Api.post('/api/groups/join', { name, password });
      Toast.success(`Joined "${res.group.name}"!`);
      closeModal('newModal');
      e.target.reset();
      await loadGroups();
      switchSidebarTab('groups');
      socket.emit('group:joined', { groupId: res.group.id });
      openChat('group', res.group.id, { name: res.group.name, sub: 'Group', avatarColor: res.group.avatarColor });
    } catch (err) {
      errorEl.textContent = err.data?.message || err.message;
    }
  });

  // Close emoji panel on outside click
  document.addEventListener('click', (e) => {
    const panel = document.getElementById('emojiPanel');
    const btn = document.getElementById('emojiBtn');
    if (!panel.contains(e.target) && e.target !== btn) panel.classList.add('hidden');
  });

  // Refresh presence/last-seen labels periodically
  setInterval(() => {
    if (activeChat && activeChat.type === 'private') {
      const status = onlineStatusCache.get(activeChat.otherUserId);
      if (status && !status.isOnline && status.lastSeen) {
        document.getElementById('chatHeaderSub').textContent = 'last seen ' + timeAgo(status.lastSeen);
      }
    }
  }, 30000);
}
