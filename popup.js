const STORAGE_KEY = 'quil-notes';

const SPRITE_PATH = 'icons/sprite.svg';

/* ─── Helpers ─── */

function getNotes() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveNotes(notes) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(text));
  return div.innerHTML;
}

function formatTimestamp(date) {
  const now = new Date();
  const d = new Date(date);
  const diff = now - d;
  const oneDay = 86400000;

  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  if (diff < oneDay && d.getDate() === now.getDate()) {
    return `Today at ${time}`;
  }
  if (diff < 2 * oneDay && d.getDate() === now.getDate() - 1) {
    return `Yesterday at ${time}`;
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ` at ${time}`;
}

function iconUse(name, size) {
  return `<svg width="${size}" height="${size}"><use href="${SPRITE_PATH}#icon-${name}"/></svg>`;
}

/* ─── Tab Switching ─── */

function switchTab(tabId) {
  document.querySelectorAll('.nav-item').forEach((item) => {
    const isActive = item.dataset.tab === tabId;
    item.classList.toggle('active', isActive);
    item.setAttribute('aria-selected', isActive);
  });

  document.querySelectorAll('.tab-panel').forEach((panel) => {
    panel.classList.toggle('active', panel.id === `panel-${tabId}`);
  });

  if (tabId === 'list') {
    render();
  }

  if (tabId === 'new') {
    document.querySelector('#titleInput').focus();
  }
}

/* ─── Render ─── */

function render() {
  const notes = getNotes();
  const list = document.querySelector('#noteList');

  if (notes.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">&#128221;</div>
        <div class="empty-state-text">No notes yet.<br>Write one above!</div>
      </div>`;
    return;
  }

  list.innerHTML = notes
    .map(
      (note, i) => `
      <div class="note-card" data-index="${i}">
        <div class="note-card-header">
          <span class="note-timestamp">${formatTimestamp(note.createdAt)}</span>
          <div class="note-card-actions">
            <button class="icon-btn delete-btn" data-index="${i}" title="Delete note" aria-label="Delete note">
              ${iconUse('delete', 14)}
            </button>
            <button class="icon-btn menu-btn" data-index="${i}" title="More" aria-label="More options">
              ${iconUse('menu', 14)}
            </button>
          </div>
        </div>
        <div class="note-title">${escapeHtml(note.title || 'Untitled')}</div>
        <div class="note-preview">${escapeHtml(note.body || 'No content')}</div>
      </div>`
    )
    .join('');
}

/* ─── Actions ─── */

function addNote() {
  const titleInput = document.querySelector('#titleInput');
  const bodyInput = document.querySelector('#bodyInput');
  const title = titleInput.value.trim();
  const body = bodyInput.value.trim();

  if (!title && !body) return;

  const notes = getNotes();
  notes.unshift({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    title: title || 'Untitled',
    body: body || 'No content',
    createdAt: new Date().toISOString(),
  });
  saveNotes(notes);

  titleInput.value = '';
  bodyInput.value = '';
  switchTab('list');
}

function deleteNote(index) {
  const notes = getNotes();
  notes.splice(index, 1);
  saveNotes(notes);
  render();
}

/* ─── Event Listeners ─── */

document.addEventListener('DOMContentLoaded', render);

document.querySelector('#titleInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    document.querySelector('#bodyInput').focus();
  }
});

document.querySelector('#bodyInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    addNote();
  }
});

document.querySelector('#app').addEventListener('click', (e) => {
  const tabBtn = e.target.closest('.nav-item');
  if (tabBtn) {
    switchTab(tabBtn.dataset.tab);
    return;
  }

  const deleteBtn = e.target.closest('.delete-btn');
  if (deleteBtn) {
    deleteNote(parseInt(deleteBtn.dataset.index));
    return;
  }

  const card = e.target.closest('.note-card');
  if (card) {
    document.querySelectorAll('.note-card').forEach((c) => c.classList.remove('active'));
    card.classList.add('active');
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelector('#titleInput').blur();
    document.querySelector('#bodyInput').blur();
    document.querySelectorAll('.note-card').forEach((c) => c.classList.remove('active'));
  }
});
