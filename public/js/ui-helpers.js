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

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function formatClock(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDateLabel(dateStr) {
  const d = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
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
