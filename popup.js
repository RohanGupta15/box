const STORAGE_KEY = "box-notes";
const THEME_KEY = "box-theme";
const DRAFT_KEY = "box-draft";

const SPRITE_PATH = "icons/sprite.svg";

/* ─── Helpers ─── */

// Older versions saved the "Untitled" / "No content" placeholders as if the user had typed them.
function dropOldPlaceholders(note) {
  return {
    ...note,
    title: note.title === "Untitled" ? "" : note.title,
    body: note.body === "No content" ? "" : note.body,
  };
}

async function getNotes() {
  const stored = await browser.storage.local.get(STORAGE_KEY);
  if (stored[STORAGE_KEY]) return stored[STORAGE_KEY].map(dropOldPlaceholders);

  // One-time migration from the old localStorage copy.
  try {
    const legacy = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    if (legacy.length) {
      await saveNotes(legacy);
      localStorage.removeItem(STORAGE_KEY);
    }
    return legacy.map(dropOldPlaceholders);
  } catch {
    return [];
  }
}

function saveNotes(notes, retry) {
  return browser.storage.local.set({ [STORAGE_KEY]: notes }).catch((err) => {
    showToast("Couldn't save your changes", "error", retry && { label: "Try again", onClick: retry });
    throw err; // callers stop here, so an unsaved note stays in the editor and a failed delete isn't reported as done
  });
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.appendChild(document.createTextNode(text));
  return div.innerHTML.replaceAll('"', "&quot;"); // quotes too, so the text is also safe inside an attribute
}

// Pasted text brings its source's colors and fonts (dark text vanishes in dark mode) and class/id names Box's own CSS and code would catch.
function dropPastedStyling(root) {
  root.querySelectorAll("[style]").forEach((el) => {
    ["color", "background", "font-family", "font-size"].forEach((name) => el.style.removeProperty(name));
    if (!el.style.length) el.removeAttribute("style");
  });
  root.querySelectorAll("*").forEach((el) => {
    ["class", "id", "color", "bgcolor", "background", "face", "size"].forEach((name) => el.removeAttribute(name));
  });
}

function sanitizeHtml(html) {
  const t = document.createElement("template");
  t.innerHTML = html;
  t.content.querySelectorAll("script, style, iframe, object, embed").forEach((el) => el.remove());
  t.content.querySelectorAll("*").forEach((el) => {
    [...el.attributes].forEach((attr) => {
      // Pasted screenshots arrive as data: images, and an <img> can't run script; data: stays blocked everywhere else.
      const pastedImage = el.matches("img") && attr.name === "src" && /^\s*data:image\//i.test(attr.value);
      const unsafeUrl = !pastedImage && /^\s*(javascript|data|vbscript):/i.test(attr.value);
      if (attr.name.startsWith("on") || unsafeUrl) el.removeAttribute(attr.name);
    });
  });
  dropPastedStyling(t.content);
  return t.innerHTML;
}

function stripHtml(html, { forCopy } = {}) {
  const t = document.createElement("template");
  t.innerHTML = html;
  // shortcut: fits the editor's own div/li/br markup; pasted nested blocks may gain or lose a break, upgrade if that shows up.
  t.content.querySelectorAll("br").forEach((br) => {
    // A <br> that ends a block only holds an empty line open; any other <br> breaks the line.
    if (!br.nextSibling && br.parentElement?.matches("div, p, li")) br.remove();
    else br.replaceWith("\n");
  });
  // Plain text has no list styling or links, so each item spells out its bullet or number, and each link its address.
  // shortcut: nested items aren't indented, upgrade if pasted nested lists show up.
  if (forCopy) {
    t.content.querySelectorAll("ul, ol").forEach((list) => {
      list.querySelectorAll(":scope > li").forEach((li, i) => li.prepend(list.matches("ol") ? `${list.start + i}. ` : "• "));
    });
    t.content.querySelectorAll("a[href]").forEach((a) => {
      const url = a.getAttribute("href").trim();
      // A link that already reads as its address isn't repeated, even when only one of them ends in a slash.
      if (url && url.replace(/\/$/, "") !== a.textContent.trim().replace(/\/$/, "")) a.after(` (${url})`);
    });
  }
  t.content.querySelectorAll("div, p, li").forEach((el) => el.before("\n"));
  return t.content.textContent.trim();
}

// Text or an image makes a note body; an emptied editor can keep bare markup like a lone <br>.
function hasBody(html) {
  return Boolean(stripHtml(html)) || html.includes("<img");
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
  const year = d.getFullYear() === new Date().getFullYear() ? undefined : "numeric";
  return (
    d.toLocaleDateString([], { month: "short", day: "numeric", year }) + ` at ${time}`
  );
}

// "Edited today at 14:05" once a note has been changed, otherwise when it was written.
function noteTimestamp(note) {
  if (!note.updatedAt) return formatTimestamp(note.createdAt);
  return `Edited ${formatTimestamp(note.updatedAt).replace(/^(Today|Yesterday)/, (day) => day.toLowerCase())}`;
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
    item.tabIndex = isActive ? 0 : -1; // only the selected tab is in the Tab order; arrows reach the other
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

  // Redrawing replaces every card, so keep focus in the list: on the same note, or the one now in its place.
  const focused = document.activeElement?.closest(".note-card");
  const pos = [...list.children].indexOf(focused);
  list.innerHTML = notes
    .map((note) => {
      // Each button names its note, by title or else text, so cards sound different; kept short as it's read on every button.
      const name = escapeHtml((note.title?.trim() || stripHtml(note.body)).replace(/\s+/g, " ").slice(0, 40) || "Untitled");
      return `
      <div class="note-card" data-id="${note.id}" tabindex="0">
        <div class="note-card-header">
          <span class="note-timestamp">${noteTimestamp(note)}</span>
          <div class="note-card-actions">
            <button class="icon-btn danger delete-btn" data-id="${note.id}" title="Delete note: ${name}" aria-label="Delete note: ${name}">
              ${iconUse("delete", 14)}
            </button>
            <button class="icon-btn edit-btn" data-id="${note.id}" title="Edit note: ${name}" aria-label="Edit note: ${name}">
              ${iconUse("edit", 14)}
            </button>
            <button class="icon-btn copy-btn" data-id="${note.id}" title="Copy note: ${name}" aria-label="Copy note: ${name}">
              ${iconUse("copy", 14)}
            </button>
          </div>
        </div>
        <div class="note-title">${escapeHtml(note.title || "Untitled")}</div>
        <div class="note-preview">${sanitizeHtml(note.body || "No content")}</div>
      </div>`;
    })
    .join("");
  if (focused) {
    const cards = [...list.children];
    (cards.find((c) => c.dataset.id === focused.dataset.id) ?? cards[pos] ?? cards.at(-1)).focus();
  }
}

/* ─── Actions ─── */

async function addNote() {
  const titleInput = document.querySelector("#titleInput");
  const bodyEditor = document.querySelector("#bodyEditor");
  const title = titleInput.value.trim();
  const rawBody = sanitizeHtml(bodyEditor.innerHTML).trim();
  const body = hasBody(rawBody) ? rawBody : "";

  if (!title && !body) return;

  const notes = await getNotes();
  const existing = notes.find((n) => n.id === editingId);
  if (existing) {
    // The editor tidies stored HTML (e.g. & to &amp;), so compare the tidied form or an unchanged re-save counts as an edit.
    if (existing.title !== title || sanitizeHtml(existing.body).trim() !== body) existing.updatedAt = new Date().toISOString();
    existing.title = title;
    existing.body = body;
  } else {
    notes.unshift({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      title,
      body,
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
  document.querySelector("#bodyEditor").innerHTML = sanitizeHtml(note.body);
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
  if (!draft || !(draft.title.trim() || hasBody(draft.body))) return next();
  showToast("You have unsaved changes", "error", { label: "Discard", onClick: next });
}

async function deleteNote(id) {
  const notes = await getNotes();
  const index = notes.findIndex((n) => n.id === id);
  if (index === -1) return;
  const [removed] = notes.splice(index, 1);
  await saveNotes(notes);
  render();

  showToast("Note deleted. Press Ctrl+Z or", "success", {
    keys: "Control+Z",
    label: "Undo",
    onClick: async function undo() {
      const current = await getNotes();
      current.splice(Math.min(index, current.length), 0, removed);
      // The deleted note now exists only in this popup, so a failed Undo can be tried again.
      await saveNotes(current, undo);
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

// Ctrl+Z (Cmd+Z on Mac) presses Undo while it shows; text fields keep their own undo.
document.addEventListener("keydown", (e) => {
  const undo = document.querySelector('#toast.show [aria-keyshortcuts="Control+Z"]');
  if (!undo || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.key.toLowerCase() !== "z") return;
  if (e.target.closest("input, textarea, [contenteditable]")) return;
  e.preventDefault();
  undo.click();
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

// Paste and drop put text straight into the editor, so clean it now rather than only once the note is saved.
document.querySelector("#bodyEditor").addEventListener("input", (e) => {
  if (e.inputType?.startsWith("insertFrom")) dropPastedStyling(e.currentTarget);
});

document.querySelector("#searchInput").addEventListener("input", render);
document.querySelector("#titleInput").addEventListener("input", saveDraft);
document.querySelector("#bodyEditor").addEventListener("input", saveDraft);

// :empty misses an emptied editor that still holds markup like a lone <br>; an empty list still shows its bullet, so it isn't blank.
function markBlankEditor() {
  const editor = document.querySelector("#bodyEditor");
  editor.classList.toggle("blank", !hasBody(editor.innerHTML) && !editor.querySelector("ul, ol"));
}
// Also refresh the toolbar: code swaps the editor's content (edit, new note, draft) without a key or click.
new MutationObserver(() => {
  markBlankEditor();
  updateToolbarState();
}).observe(document.querySelector("#bodyEditor"), {
  childList: true,
  subtree: true,
  characterData: true,
});

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
      const on = document.queryCommandState(cmd);
      btn.classList.toggle("active", on);
      // Only the on/off buttons carry aria-pressed; Remove formatting is a one-shot action.
      if (btn.hasAttribute("aria-pressed")) btn.setAttribute("aria-pressed", on);
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

/* ─── Arrow keys in the tabs and toolbar ─── */

// Where Left/Right/Home/End move focus in a row of n items, wrapping around; null for any other key.
function roveIndex(key, i, n) {
  if (key === "Home") return 0;
  if (key === "End") return n - 1;
  const step = { ArrowLeft: -1, ArrowRight: 1 }[key];
  return step ? (i + step + n) % n : null;
}

// Arrow keys move focus along a row of items; each group's tabIndex decides where Tab lands.
function arrowKeys(group, selector) {
  group.addEventListener("keydown", (e) => {
    if (!e.target.matches(selector)) return;
    const items = [...group.querySelectorAll(selector)];
    const next = roveIndex(e.key, items.indexOf(e.target), items.length);
    if (next === null) return;
    e.preventDefault();
    items[next].focus();
  });
}

// Tabs: arrows only move focus and Enter or Space selects, so passing over New doesn't trigger
// the unsaved-changes prompt; switchTab keeps the selected tab in the Tab order.
arrowKeys(document.querySelector(".nav"), ".nav-item");

// Toolbar: Tab comes back to the button used last.
const toolbar = document.querySelector("#toolbar");
arrowKeys(toolbar, ".tb-btn");
toolbar.addEventListener("focusin", (e) => {
  if (!e.target.matches(".tb-btn")) return;
  toolbar.querySelectorAll(".tb-btn").forEach((btn) => (btn.tabIndex = btn === e.target ? 0 : -1));
});

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
    if (action.keys) btn.setAttribute("aria-keyshortcuts", action.keys);
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

  // It waits while the pointer is on it or focus is in it, so Undo can't vanish mid-reach.
  const hide = () => {
    if (toast.matches(".show:hover, .show:focus-within")) window._toastTimer = setTimeout(hide, 1000);
    else toast.classList.remove("show");
  };
  window._toastTimer = setTimeout(hide, action ? 5000 : 3000);
}

function copyTextToClipboard(text) {
  return navigator.clipboard.writeText(text);
}

async function copyContent(id) {
  const note = (await getNotes()).find((n) => n.id === id);
  if (!note) return;

  copyTextToClipboard([note.title, stripHtml(note.body, { forCopy: true })].filter(Boolean).join("\n\n"))
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

// A data: link rather than a blob URL, so the download survives Firefox closing the popup to show it.
document.querySelector("#export-btn").addEventListener("click", async () => {
  const notes = await getNotes();
  if (!notes.length) return showToast("No notes to export", "error");
  const link = document.createElement("a");
  link.href = `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(notes, null, 2))}`;
  const d = new Date();
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  link.download = `box-notes-${day}.json`;
  document.body.append(link); // attached first: older Firefox ignored clicks on detached links
  link.click();
  link.remove();
});

// Firefox closes the popup when a file picker opens, so the backup is picked in a small window of its own.
document.querySelector("#import-btn").addEventListener("click", async () => {
  await getNotes(); // runs the one-time move of very old notes out of localStorage before import.js writes
  browser.windows
    .create({ url: "import.html", type: "popup", width: 400, height: 320 })
    .then(() => window.close())
    .catch(() => showToast("Couldn't open the import window", "error"));
});
