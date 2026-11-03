const STORAGE_KEY = "box-notes";
const THEME_KEY = "box-theme";
const DRAFT_KEY = "box-draft";

const SPRITE_PATH = "icons/sprite.svg";

/* ─── Helpers ─── */

async function getNotes() {
  const stored = await browser.storage.local.get(STORAGE_KEY);
  if (stored[STORAGE_KEY]) return stored[STORAGE_KEY];

  // One-time migration from the old localStorage copy.
  try {
    const legacy = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    if (legacy.length) {
      await saveNotes(legacy);
      localStorage.removeItem(STORAGE_KEY);
    }
    return legacy;
  } catch {
    return [];
  }
}

function saveNotes(notes) {
  return browser.storage.local.set({ [STORAGE_KEY]: notes });
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.appendChild(document.createTextNode(text));
  return div.innerHTML;
}

function sanitizeHtml(html) {
  const t = document.createElement("template");
  t.innerHTML = html;
  t.content.querySelectorAll("script, style, iframe, object, embed").forEach((el) => el.remove());
  t.content.querySelectorAll("*").forEach((el) => {
    [...el.attributes].forEach((attr) => {
      const unsafeUrl = /^\s*(javascript|data|vbscript):/i.test(attr.value);
      if (attr.name.startsWith("on") || unsafeUrl) el.removeAttribute(attr.name);
    });
  });
  return t.innerHTML;
}

function stripHtml(html) {
  const t = document.createElement("template");
  t.innerHTML = html;
  return t.textContent;
}

function formatTimestamp(date) {
  const d = new Date(date);
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  if (d.toDateString() === new Date().toDateString()) {
    return `Today at ${time}`;
  }
  if (d.toDateString() === yesterday.toDateString()) {
    return `Yesterday at ${time}`;
  }
  return (
    d.toLocaleDateString([], { month: "short", day: "numeric" }) + ` at ${time}`
  );
}

function iconUse(name, size) {
  return `<svg width="${size}" height="${size}"><use href="${SPRITE_PATH}#icon-${name}"/></svg>`;
}

/* ─── Tab Switching ─── */

function switchTab(tabId) {
  document.querySelectorAll(".nav-item").forEach((item) => {
    const isActive = item.dataset.tab === tabId;
    item.classList.toggle("active", isActive);
    item.setAttribute("aria-selected", isActive);
  });

  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === `panel-${tabId}`);
  });

  if (tabId === "list") {
    render();
  }

  if (tabId === "new") {
    document.querySelector("#titleInput").focus();
  }
}

/* ─── Render ─── */

async function render() {
  const notes = await getNotes();
  const list = document.querySelector("#noteList");

  if (notes.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">${iconUse("notes", 32)}</div>
        <div class="empty-state-text">No notes yet.<br>Write one in the New tab.</div>
      </div>`;
    return;
  }

  list.innerHTML = notes
    .map(
      (note) => `
      <div class="note-card" data-id="${note.id}" tabindex="0">
        <div class="note-card-header">
          <span class="note-timestamp">${formatTimestamp(note.createdAt)}</span>
          <div class="note-card-actions">
            <button class="icon-btn danger delete-btn" data-id="${note.id}" title="Delete note" aria-label="Delete note">
              ${iconUse("delete", 14)}
            </button>
            <button class="icon-btn edit-btn" data-id="${note.id}" title="Edit note" aria-label="Edit note">
              ${iconUse("reading", 14)}
            </button>
            <button class="icon-btn copy-btn" data-id="${note.id}" title="Copy note" aria-label="Copy note">
              ${iconUse("copy", 14)}
            </button>
          </div>
        </div>
        <div class="note-title">${escapeHtml(note.title || "Untitled")}</div>
        <div class="note-preview">${sanitizeHtml(note.body || "No content")}</div>
      </div>`,
    )
    .join("");
}

/* ─── Actions ─── */

async function addNote() {
  const titleInput = document.querySelector("#titleInput");
  const bodyEditor = document.querySelector("#bodyEditor");
  const title = titleInput.value.trim();
  const rawBody = sanitizeHtml(bodyEditor.innerHTML).trim();
  const body = rawBody || "";

  if (!title && !body) return;

  const notes = await getNotes();
  const existing = notes.find((n) => n.id === editingId);
  if (existing) {
    existing.title = title || "Untitled";
    existing.body = body || "No content";
  } else {
    notes.unshift({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      title: title || "Untitled",
      body: body || "No content",
      createdAt: new Date().toISOString(),
    });
  }
  await saveNotes(notes);

  setEditing(null);
  titleInput.value = "";
  bodyEditor.innerHTML = "";
  await browser.storage.local.remove(DRAFT_KEY);
  switchTab("list");
}

let editingId = null;

function setEditing(id) {
  editingId = id;
  document.querySelector("#composerTitle").textContent = id ? "Edit Note" : "New Note";
  document.querySelector("#saveLabel").textContent = id ? "Save Changes" : "Save Note";
}

async function editNote(id) {
  const note = (await getNotes()).find((n) => n.id === id);
  if (!note) return;
  setEditing(id);
  document.querySelector("#titleInput").value = note.title;
  document.querySelector("#bodyEditor").innerHTML = sanitizeHtml(note.body === "No content" ? "" : note.body);
  saveDraft();
  switchTab("new");
}

function startNewNote() {
  setEditing(null);
  document.querySelector("#titleInput").value = "";
  document.querySelector("#bodyEditor").innerHTML = "";
  browser.storage.local.remove(DRAFT_KEY);
}

// Firefox popups don't support confirm(), so delete needs a second click.
function deleteNote(btn) {
  if (!btn.classList.contains("armed")) {
    btn.classList.add("armed");
    btn.setAttribute("aria-label", "Click again to delete");
    btn.title = "Click again to delete";
    showToast("Click delete again to confirm", "error");
    setTimeout(() => {
      btn.classList.remove("armed");
      btn.setAttribute("aria-label", "Delete note");
      btn.title = "Delete note";
    }, 3000);
    return;
  }
  getNotes()
    .then((notes) => saveNotes(notes.filter((n) => n.id !== btn.dataset.id)))
    .then(render);
}

/* ─── Event Listeners ─── */

document.querySelector("#titleInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    document.querySelector("#bodyEditor").focus();
  }
});

document.querySelector("#bodyEditor").addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    e.preventDefault();
    addNote();
  }
});

document.querySelector("#app").addEventListener("click", (e) => {
  const closeBtn = e.target.closest("[aria-label='Close']");
  if (closeBtn) {
    window.close();
    return;
  }

  const tabBtn = e.target.closest(".nav-item");
  if (tabBtn) {
    // Tapping New while editing starts a fresh note; the saved one is untouched.
    if (tabBtn.dataset.tab === "new" && editingId) startNewNote();
    switchTab(tabBtn.dataset.tab);
    return;
  }

  const editBtn = e.target.closest(".edit-btn");
  if (editBtn) {
    editNote(editBtn.dataset.id);
    return;
  }

  const deleteBtn = e.target.closest(".delete-btn");
  if (deleteBtn) {
    deleteNote(deleteBtn);
    return;
  }

  const card = e.target.closest(".note-card");
  if (card) {
    document
      .querySelectorAll(".note-card")
      .forEach((c) => c.classList.remove("active"));
    card.classList.add("active");
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    document.querySelector("#titleInput").blur();
    document.querySelector("#bodyEditor").blur();
    document
      .querySelectorAll(".note-card")
      .forEach((c) => c.classList.remove("active"));
  }
});

// The popup closes on any outside click, so keep the unsaved note in storage.
function saveDraft() {
  browser.storage.local.set({
    [DRAFT_KEY]: {
      title: document.querySelector("#titleInput").value,
      body: document.querySelector("#bodyEditor").innerHTML,
      editingId,
    },
  });
}

document.querySelector("#titleInput").addEventListener("input", saveDraft);
document.querySelector("#bodyEditor").addEventListener("input", saveDraft);

browser.storage.local.get(DRAFT_KEY).then(({ [DRAFT_KEY]: draft }) => {
  if (!draft) return;
  setEditing(draft.editingId || null);
  document.querySelector("#titleInput").value = draft.title;
  document.querySelector("#bodyEditor").innerHTML = sanitizeHtml(draft.body);
});

document.querySelector("#saveBtn").addEventListener("click", (e) => {
  e.preventDefault();
  addNote();
});

function updateToolbarState() {
  document.querySelectorAll("[data-cmd]").forEach((btn) => {
    const cmd = btn.dataset.cmd;
    try {
      btn.classList.toggle("active", document.queryCommandState(cmd));
    } catch {}
  });
}

document.querySelector("#toolbar").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-cmd]");
  if (!btn) return;
  e.preventDefault();
  document.execCommand(btn.dataset.cmd, false, null);
  document.querySelector("#bodyEditor").focus();
  updateToolbarState();
});

["mouseup", "keyup"].forEach((type) =>
  document.querySelector("#bodyEditor").addEventListener(type, updateToolbarState),
);

document.querySelector("#noteList").addEventListener("click", (e) => {
  const copyBtn = e.target.closest(".copy-btn");
  if (copyBtn) {
    copyContent(copyBtn.dataset.id);
  }
});

function showToast(message, type) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.className = "notification " + type;
  toast.classList.add("show");

  if (window._toastTimer) {
    clearTimeout(window._toastTimer);
  }

  window._toastTimer = setTimeout(() => {
    toast.classList.remove("show");
  }, 3000);
}

function copyTextToClipboard(text) {
  return navigator.clipboard.writeText(text);
}

async function copyContent(id) {
  const note = (await getNotes()).find((n) => n.id === id);
  if (!note) return;

  copyTextToClipboard(`${note.title}\n\n${stripHtml(note.body)}`)
    .then(() => {
      showToast("Copied to clipboard", "success");
    })
    .catch(() => {
      showToast("Copy failed", "error");
    });
}

function getTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved) return saved;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function saveTheme(theme) {
  localStorage.setItem(THEME_KEY, theme);
}

function applyTheme(theme) {
  document.body.classList.toggle("dark", theme === "dark");
  updateThemeIcon(theme);
}

function updateThemeIcon(theme) {
  const use = document.querySelector("#theme-btn use");
  use.setAttribute("href", `${SPRITE_PATH}#icon-${theme === "dark" ? "sun" : "moon"}`);
}

// Runs synchronously at script load (end of body) to avoid a light flash.
applyTheme(getTheme());

document.querySelector("#theme-btn").addEventListener("click", () => {
  const isDark = document.body.classList.contains("dark");
  const newTheme = isDark ? "light" : "dark";
  applyTheme(newTheme);
  saveTheme(newTheme);
  showToast(`Switched to ${newTheme} mode`, "success");
});
