// Served as /app.js. The filters of the request list apply as soon as a list changes. Without
// JavaScript, the button of the form still applies them. Only lists submit the form: the search
// field waits for the button or the Enter key, so a person can finish typing.
export const script = `
for (const form of document.querySelectorAll("form.filters")) {
  form.addEventListener("change", (event) => {
    if (event.target instanceof HTMLSelectElement) {
      form.requestSubmit();
    }
  });
}
`;
