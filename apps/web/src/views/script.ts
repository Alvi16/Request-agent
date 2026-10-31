// Served as /app.js. The request list follows its filters as a person types or chooses, as the
// search box of a website does: only the results are replaced, so the search field keeps the focus
// and what is being typed. Without JavaScript, the button of the form applies the filters.
export const script = `
const typingDelayMs = 250;

for (const form of document.querySelectorAll("form.filters")) {
  const results = document.getElementById("results");
  if (results === null) {
    continue;
  }
  let timer;
  let running;

  async function update() {
    clearTimeout(timer);
    running?.abort();
    running = new AbortController();
    const query = new URLSearchParams(new FormData(form));
    const url = form.action + "?" + query.toString();
    try {
      const response = await fetch(url, { signal: running.signal });
      const page = new DOMParser().parseFromString(await response.text(), "text/html");
      const fresh = page.getElementById("results");
      if (!response.ok || response.redirected || fresh === null) {
        // Signed out or failed: the browser shows the page as it would for the form.
        window.location.assign(url);
        return;
      }
      results.replaceChildren(...fresh.childNodes);
      history.replaceState(null, "", url);
    } catch (error) {
      if (error.name !== "AbortError") {
        window.location.assign(url);
      }
    }
  }

  form.addEventListener("input", (event) => {
    if (event.target instanceof HTMLInputElement) {
      clearTimeout(timer);
      timer = setTimeout(update, typingDelayMs);
    }
  });
  form.addEventListener("change", (event) => {
    if (event.target instanceof HTMLSelectElement) {
      update();
    }
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    update();
  });
  for (const button of form.querySelectorAll("button[type=submit]")) {
    button.hidden = true;
  }
}
`;
