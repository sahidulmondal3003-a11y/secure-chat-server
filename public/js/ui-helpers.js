/**
 * ui-helpers.js - dark/light theme toggle, toast notifications, small utils.
 */
const Theme = (() => {
  function apply(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('scs_theme', theme);
    document.querySelectorAll('.theme-icon').forEach((el) => {
      el.textContent = theme === 'dark' ? '🌙' : '☀️';
    });
  }
  function toggle() {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    apply(current === 'dark' ? 'light' : 'dark');
  }
  function init() {
    const saved = localStorage.getItem('scs_theme') || 'dark';
    apply(saved);
  }
  return { init, toggle, apply };
})();

const Toast = (() => {
  function container() {
    let c = document.querySelector('.toast-container');
    if (!c) {
      c = document.createElement('div');
      c.className = 'toast-container';
      document.body.appendChild(c);
    }
    return c;
  }
  function show(message, type = 'info', duration = 3500) {
    const el = document.createElement('div');
    el.className = `toast glass ${type}`;
    el.textContent = message;
    container().appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateX(120%)';
      el.style.transition = 'all 0.3s ease';
      setTimeout(() => el.remove(), 300);
    }, duration);
  }
  return {
    success: (msg) => show(msg, 'success'),
    error: (msg) => show(msg, 'error'),
    info: (msg) => show(msg, 'info'),
  };
})();

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

const IST_TZ = 'Asia/Kolkata';

// 'YYYY-MM-DD' for a date as it falls in India Standard Time, regardless of
// the viewer's own device/browser timezone - used to compare calendar days.
function istDateString(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: IST_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) {
    const mins = Math.max(1, Math.floor(diff / 60));
    return `${mins} min ago`;
  }
  if (diff < 86400) {
    const hrs = Math.floor(diff / 3600);
    return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
  }
  const days = Math.floor(diff / 86400);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  return formatDateLabel(dateStr);
}

// "10:45 AM" - always rendered in IST, no matter where the viewer is.
function formatClock(dateStr) {
  const d = new Date(dateStr);
  return new Intl.DateTimeFormat('en-US', { timeZone: IST_TZ, hour: 'numeric', minute: '2-digit', hour12: true }).format(d);
}

function formatDateLabel(dateStr) {
  const d = new Date(dateStr);
  const now = new Date();
  const dStr = istDateString(d);
  if (dStr === istDateString(now)) return 'Today';
  if (dStr === istDateString(new Date(now.getTime() - 86400000))) return 'Yesterday';
  return new Intl.DateTimeFormat('en-GB', { timeZone: IST_TZ, day: 'numeric', month: 'short', year: 'numeric' }).format(d);
}

function formatFileSize(bytes) {
  if (!bytes) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let val = bytes;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i++;
  }
  return `${val.toFixed(val < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

function initials(name) {
  if (!name) return '?';
  return name.trim().slice(0, 2).toUpperCase();
}

// Inline style string for an .avatar element: shows the uploaded picture
// (cropped to circle via CSS) when present, otherwise falls back to a
// solid background color so the initials/emoji glyph stays readable.
function avatarStyle(color, url) {
  if (url) return `background-image:url('${escapeHtml(url)}');`;
  return `background:${escapeHtml(color || '#6366f1')};`;
}

// Inner glyph (initials or group emoji) to show only when there's no
// picture set — an <img>-backed avatar shouldn't also render initials text.
function avatarGlyph(url, name, isGroup) {
  if (url) return '';
  return isGroup ? '👥' : escapeHtml(initials(name));
}

// Directly apply avatar (picture or color+glyph) to an existing DOM element,
// for spots where the avatar isn't built from an HTML template string.
function applyAvatar(el, { url, color, name, isGroup } = {}) {
  if (!el) return;
  if (url) {
    el.style.backgroundImage = `url('${url}')`;
    el.style.background = '';
    el.textContent = '';
  } else {
    el.style.backgroundImage = '';
    el.style.background = color || '#6366f1';
    el.textContent = isGroup ? '👥' : initials(name);
  }
}

function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

function showBrowserNotification(title, body) {
  if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
    try {
      new Notification(title, { body, icon: '/assets/icon.png' });
    } catch (e) {
      /* ignore */
    }
  }
}

Theme.init();
