// Same theme as the popup: both pages share the extension's localStorage.
const theme = localStorage.getItem("box-theme") ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
document.body.classList.toggle("dark", theme === "dark");

const status = document.querySelector("#picturesStatus");

// Firefox only asks for a permission straight from a click like this one.
document.querySelector("#allowBtn").addEventListener("click", async () => {
  const allowed = await browser.permissions.request({ origins: ["<all_urls>"] }).catch(() => false);
  status.textContent = allowed
    ? "Done. Pictures you paste now go into the note itself. Paste the ones that were left out again. You can close this window."
    : "Not allowed, so pictures pasted from the web are still left out. You can close this window.";
});
