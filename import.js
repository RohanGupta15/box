const STORAGE_KEY = "box-notes"; // the key popup.js keeps notes under

// Same theme as the popup: both pages share the extension's localStorage.
const theme = localStorage.getItem("box-theme") ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
document.body.classList.toggle("dark", theme === "dark");

// Keep only well-formed notes whose id isn't in Box yet, so importing never duplicates or overwrites a note.
function mergeBackup(existing, backup) {
  const isDate = (v) => typeof v === "string" && !Number.isNaN(Date.parse(v));
  const ids = new Set(existing.map((n) => n.id));
  const added = [];
  let skipped = 0;
  let invalid = 0;
  for (const n of backup) {
    const valid =
      n &&
      typeof n.id === "string" &&
      /^[a-z0-9]+$/.test(n.id) && // Box only makes a-z0-9 ids; other text could inject markup through the list's data-id attributes
      typeof n.title === "string" &&
      typeof n.body === "string" &&
      isDate(n.createdAt);
    if (!valid) invalid++;
    else if (ids.has(n.id)) skipped++;
    else {
      ids.add(n.id);
      const note = { id: n.id, title: n.title, body: n.body, createdAt: new Date(n.createdAt).toISOString() };
      if (isDate(n.updatedAt)) note.updatedAt = new Date(n.updatedAt).toISOString(); // optional: a bad one is dropped, not the note
      added.push(note);
    }
  }
  // Newest first, like the list; ISO dates sort correctly as text.
  const notes = [...existing, ...added].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { notes, added: added.length, skipped, invalid };
}

const fileInput = document.querySelector("#backupFile");
const status = document.querySelector("#importStatus");

document.querySelector("#chooseBtn").addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", async () => {
  const [file] = fileInput.files;
  fileInput.value = ""; // so choosing the same file again still fires change
  if (!file) return;

  let backup;
  try {
    backup = JSON.parse(await file.text());
    if (!Array.isArray(backup)) throw new Error("not a list of notes");
  } catch {
    status.textContent = "That file isn't a Box backup, so nothing was imported.";
    return;
  }

  let result;
  try {
    // Read the notes only now, right before writing, so the merge starts from the latest ones.
    const stored = (await browser.storage.local.get(STORAGE_KEY))[STORAGE_KEY] ?? [];
    result = mergeBackup(stored, backup);
    await browser.storage.local.set({ [STORAGE_KEY]: result.notes });
  } catch {
    status.textContent = "Couldn't save the imported notes. Your existing notes are unchanged.";
    return;
  }

  const parts = [`Imported ${result.added} ${result.added === 1 ? "note" : "notes"}.`];
  if (result.skipped) parts.push(`Skipped ${result.skipped} already in Box.`);
  if (result.invalid) parts.push(`Skipped ${result.invalid} that couldn't be read.`);
  status.textContent = `${parts.join(" ")} You can close this window.`;
});
