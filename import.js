const STORAGE_KEY = "box-notes"; // the key popup.js keeps notes under

// Same theme as the popup: both pages share the extension's localStorage.
const theme = localStorage.getItem("box-theme") ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
document.body.classList.toggle("dark", theme === "dark");

// Keep only well-formed notes whose id isn't in Box yet, so importing never duplicates or overwrites a note.
function mergeBackup(existing, backup) {
  if (!Array.isArray(backup)) throw new Error("not a Box backup");
  const ids = new Set(existing.map((n) => n.id));
  const added = [];
  let skipped = 0;
  let invalid = 0;
  for (const n of backup) {
    const valid =
      n &&
      typeof n.id === "string" &&
      n.id !== "" &&
      typeof n.title === "string" &&
      typeof n.body === "string" &&
      !Number.isNaN(Date.parse(n.createdAt));
    if (!valid) invalid++;
    else if (ids.has(n.id)) skipped++;
    else {
      ids.add(n.id);
      added.push({ id: n.id, title: n.title, body: n.body, createdAt: new Date(n.createdAt).toISOString() });
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

  const stored = (await browser.storage.local.get(STORAGE_KEY))[STORAGE_KEY] ?? [];
  let result;
  try {
    result = mergeBackup(stored, JSON.parse(await file.text()));
  } catch {
    status.textContent = "That file isn't a Box backup, so nothing was imported.";
    return;
  }
  try {
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
