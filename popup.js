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
  // shortcut: fits the editor's own div/li/br markup; pasted nested blocks may gain or lose a break, upgrade if that shows up.
  t.content.querySelectorAll("br").forEach((br) => {
    // A <br> that ends a block only holds an empty line open; any other <br> breaks the line.
    if (!br.nextSibling && br.parentElement?.matches("div, p, li")) br.remove();
    else br.replaceWith("\n");
  });
  t.content.querySelectorAll("div, p, li").forEach((el) => el.before("\n"));
  return t.content.textContent.trim();
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
  const allNotes = await getNotes();
  const list = document.querySelector("#noteList");
  const query = document.querySelector("#searchInput").value.trim().toLowerCase();
  const notes = allNotes.filter((n) =>
    `${n.title} ${stripHtml(n.body)}`.toLowerCase().includes(query),
  );

  if (allNotes.length && !notes.length) {
    list.innerHTML = `<div class="empty-state"><div class="empty-state-text">No notes match your search.</div></div>`;
    return;
  }

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
  await startNewNote();
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
  browser.storage.local.remove(DRAFT_KEY);
  switchTab("new");
}

function startNewNote() {
  setEditing(null);
  document.querySelector("#titleInput").value = "";
  document.querySelector("#bodyEditor").innerHTML = "";
  return browser.storage.local.remove(DRAFT_KEY);
}

// A draft is only written once the user types, so it marks work a composer switch would drop.
async function confirmDiscard(next) {
  const { [DRAFT_KEY]: draft } = await browser.storage.local.get(DRAFT_KEY);
  if (!draft || !(draft.title.trim() || stripHtml(draft.body))) return next();
  showToast("You have unsaved changes", "error", { label: "Discard", onClick: next });
}

async function deleteNote(id) {
  const notes = await getNotes();
  const index = notes.findIndex((n) => n.id === id);
  if (index === -1) return;
  const [removed] = notes.splice(index, 1);
  await saveNotes(notes);
  render();

  showToast("Note deleted", "success", {
    label: "Undo",
    onClick: async () => {
      const current = await getNotes();
      current.splice(Math.min(index, current.length), 0, removed);
      await saveNotes(current);
      render();
    },
  });
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
    if (tabBtn.dataset.tab === "new" && editingId) confirmDiscard(startNewNote);
    switchTab(tabBtn.dataset.tab);
    return;
  }

  const deleteBtn = e.target.closest(".delete-btn");
  if (deleteBtn) {
    deleteNote(deleteBtn.dataset.id);
    return;
  }

  const copyBtn = e.target.closest(".copy-btn");
  if (copyBtn) {
    copyContent(copyBtn.dataset.id);
    return;
  }

  // A link pasted into a note opens in a new tab instead of loading inside the popup.
  const link = e.target.closest(".note-preview a[href]");
  if (link) {
    e.preventDefault();
    // Web links only: a disguised scheme can slip past sanitizeHtml, and relative links point into the extension.
    if (!["http:", "https:"].includes(link.protocol)) showToast("Only web links can open from a note", "error");
    else browser.tabs.create({ url: link.href }).catch(() => showToast("Couldn't open that link", "error"));
    return;
  }

  // Anywhere else on a card, its edit button included, opens the note.
  const card = e.target.closest(".note-card");
  if (card) {
    const { id } = card.dataset;
    // The note already in the composer is reopened as is, not reloaded from its saved copy.
    if (id === editingId) switchTab("new");
    else confirmDiscard(() => editNote(id));
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    document.querySelector("#titleInput").blur();
    document.querySelector("#bodyEditor").blur();
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

document.querySelector("#searchInput").addEventListener("input", render);
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

// Enter on a focused card opens it like a click; the buttons inside handle Enter themselves.
document.querySelector("#noteList").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.classList.contains("note-card")) e.target.click();
});

function showToast(message, type, action) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.className = "notification " + type;
  toast.classList.add("show");

  if (action) {
    const btn = document.createElement("button");
    btn.className = "toast-action";
    btn.textContent = action.label;
    btn.addEventListener(
      "click",
      () => {
        toast.classList.remove("show");
        action.onClick();
      },
      { once: true },
    );
    toast.append(" ", btn);
  }

  if (window._toastTimer) {
    clearTimeout(window._toastTimer);
  }

  window._toastTimer = setTimeout(() => {
    toast.classList.remove("show");
  }, action ? 5000 : 3000);
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
