// Served as /widget/widget.js and embedded by an application with one script tag. It only collects
// what the person writes and shows what the server answers: the agent decides everything. Its text
// is only ever set with textContent, so nothing the server returns can run in the page.
export const widgetScript = String.raw`(() => {
  const script = document.currentScript;
  if (!(script instanceof HTMLScriptElement)) {
    return;
  }
  const base = new URL(script.src).origin;
  const data = script.dataset;
  const signedIn = (data.userSignature ?? "") !== "";
  const storageKey = "request-widget-conversations";
  const pollMs = 5000;
  const kinds = [
    ["QUESTION", "Poser une question"],
    ["BUG", "Signaler un bug"],
    ["EVOLUTION", "Demander une évolution"],
  ];

  function savedConversations() {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
      return Array.isArray(saved) ? saved.filter((item) => typeof item?.token === "string") : [];
    } catch {
      return [];
    }
  }

  function saveConversation(token, title) {
    try {
      const others = savedConversations().filter((item) => item.token !== token);
      localStorage.setItem(storageKey, JSON.stringify([{ token, title }, ...others].slice(0, 20)));
    } catch {
      // Without storage, the conversation stays reachable until the page is closed.
    }
  }

  function element(tag, attributes = {}, ...children) {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(attributes)) {
      if (name === "text") {
        node.textContent = value;
      } else if (name.startsWith("on")) {
        node.addEventListener(name.slice(2), value);
      } else {
        node.setAttribute(name, value);
      }
    }
    node.append(...children);
    return node;
  }

  const css = [
    ":host { all: initial; }",
    "* { box-sizing: border-box; font-family: system-ui, sans-serif; }",
    ".launcher { position: fixed; right: 20px; bottom: 20px; z-index: 2147483647; border: none; border-radius: 999px; padding: 12px 18px; background: #6c5ce7; color: #fff; font-size: 15px; cursor: pointer; box-shadow: 0 6px 20px rgba(0,0,0,.25); }",
    ".panel { position: fixed; right: 20px; bottom: 76px; z-index: 2147483647; width: 360px; max-width: calc(100vw - 32px); max-height: calc(100vh - 100px); display: flex; flex-direction: column; background: #fff; color: #1d1d29; border-radius: 14px; box-shadow: 0 12px 40px rgba(0,0,0,.3); overflow: hidden; font-size: 14px; }",
    ".panel[hidden] { display: none; }",
    "header { display: flex; gap: 4px; padding: 10px; background: #6c5ce7; }",
    "header button { flex: 1; border: none; border-radius: 8px; padding: 8px; background: transparent; color: #fff; cursor: pointer; font-size: 14px; }",
    "header button[aria-pressed=true] { background: rgba(255,255,255,.22); }",
    ".body { padding: 14px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; }",
    "form { display: flex; flex-direction: column; gap: 10px; }",
    "label { display: flex; flex-direction: column; gap: 4px; font-weight: 600; }",
    "select, textarea, input { font: inherit; padding: 8px; border: 1px solid #c9c9d6; border-radius: 8px; }",
    "textarea { min-height: 100px; resize: vertical; }",
    ".row { display: flex; gap: 8px; flex-wrap: wrap; }",
    ".primary { border: none; border-radius: 8px; padding: 10px 14px; background: #6c5ce7; color: #fff; cursor: pointer; font-size: 14px; }",
    ".primary:disabled { opacity: .6; cursor: wait; }",
    ".secondary { border: 1px solid #c9c9d6; border-radius: 8px; padding: 8px 12px; background: #fff; cursor: pointer; font-size: 13px; }",
    ".muted { color: #5c5c70; font-size: 13px; margin: 0; }",
    ".error { color: #b3261e; margin: 0; }",
    "ul { margin: 0; padding: 0; list-style: none; }",
    "li { display: flex; justify-content: space-between; gap: 8px; }",
    ".bubble { padding: 8px 10px; border-radius: 10px; white-space: pre-wrap; overflow-wrap: anywhere; max-width: 85%; }",
    ".mine { align-self: flex-end; background: #ece9fd; }",
    ".agent { align-self: flex-start; background: #f1f1f5; }",
    ".request { border: 1px solid #e3e3ec; border-radius: 10px; padding: 8px 10px; }",
    ".link { border: none; background: none; color: #5b4bc4; cursor: pointer; padding: 0; text-align: left; font-size: 14px; }",
  ].join("\n");

  const host = element("div");
  const root = host.attachShadow({ mode: "open" });
  const launcher = element("button", { class: "launcher", type: "button", text: "Besoin d'aide ?" });
  const panel = element("section", { class: "panel", hidden: "", "aria-label": "Nous contacter" });
  const tabNew = element("button", { type: "button", text: "Nouvelle demande" });
  const tabMine = element("button", { type: "button", text: "Mes demandes" });
  const body = element("div", { class: "body" });
  panel.append(element("header", {}, tabNew, tabMine), body);
  root.append(element("style", { text: css }), launcher, panel);

  let poll;
  function show(tab, ...content) {
    clearTimeout(poll);
    tabNew.setAttribute("aria-pressed", String(tab === tabNew));
    tabMine.setAttribute("aria-pressed", String(tab === tabMine));
    body.replaceChildren(...content);
  }

  async function captureScreen() {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    try {
      const video = element("video");
      video.srcObject = stream;
      video.muted = true;
      await video.play();
      const canvas = element("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext("2d").drawImage(video, 0, 0);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      return new File([blob], "capture-" + new Date().toISOString().slice(0, 19) + ".png", {
        type: "image/png",
      });
    } finally {
      for (const track of stream.getTracks()) {
        track.stop();
      }
    }
  }

  function filePicker(files) {
    const list = element("ul", { class: "muted" });
    const refresh = () => {
      list.replaceChildren(
        ...files.map((file, index) =>
          element(
            "li",
            {},
            element("span", { text: file.name }),
            element("button", {
              type: "button",
              class: "link",
              text: "Retirer",
              onclick: () => {
                files.splice(index, 1);
                refresh();
              },
            }),
          ),
        ),
      );
    };
    const input = element("input", {
      type: "file",
      multiple: "",
      hidden: "",
      accept: "image/png,image/jpeg,application/pdf,text/plain",
      onchange: () => {
        files.push(...input.files);
        input.value = "";
        refresh();
      },
    });
    const buttons = element(
      "div",
      { class: "row" },
      input,
      element("button", {
        type: "button",
        class: "secondary",
        text: "Joindre un fichier",
        onclick: () => input.click(),
      }),
    );
    if (navigator.mediaDevices?.getDisplayMedia !== undefined) {
      buttons.append(
        element("button", {
          type: "button",
          class: "secondary",
          text: "Capturer l'écran",
          onclick: async () => {
            try {
              files.push(await captureScreen());
              refresh();
            } catch {
              // The person cancelled the capture.
            }
          },
        }),
      );
    }
    return element("div", {}, buttons, list);
  }

  async function send(url, form) {
    const response = await fetch(url, { method: "POST", body: form });
    const answer = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(answer.error ?? "Le message n'a pas pu être envoyé.");
    }
    return answer;
  }

  // A form that sends a text and files, then shows the conversation it belongs to.
  function messageForm(fields, submitText, url, extra) {
    const files = [];
    const text = element("textarea", { required: "", maxlength: "5000" });
    const error = element("p", { class: "error", role: "alert" });
    const submit = element("button", { type: "submit", class: "primary", text: submitText });
    const form = element("form", {}, ...fields, element("label", { text: "Message" }, text));
    form.append(filePicker(files), error, submit);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      submit.disabled = true;
      error.textContent = "";
      try {
        const payload = new FormData();
        payload.append("text", text.value);
        for (const [name, value] of Object.entries(extra())) {
          payload.append(name, value);
        }
        for (const file of files) {
          payload.append("files", file);
        }
        const { conversation } = await send(url, payload);
        saveConversation(conversation, text.value.slice(0, 80));
        showConversation(conversation);
      } catch (failure) {
        error.textContent = failure.message;
        submit.disabled = false;
      }
    });
    return form;
  }

  function showForm() {
    const kind = element(
      "select",
      {},
      ...kinds.map(([value, text]) => element("option", { value, text })),
    );
    const email = element("input", { type: "email", required: "", maxlength: "254" });
    const fields = [element("label", { text: "Votre demande" }, kind)];
    if (!signedIn) {
      fields.push(element("label", { text: "Votre adresse e-mail" }, email));
    }
    const identity = () => {
      const values = { kind: kind.value };
      if (signedIn) {
        values.email = data.userEmail ?? "";
        values.expires = data.userExpires ?? "";
        values.signature = data.userSignature ?? "";
      } else {
        values.email = email.value;
      }
      if (data.project !== undefined) {
        values.project = data.project;
      }
      return values;
    };
    show(tabNew, messageForm(fields, "Envoyer", base + "/widget/messages", identity));
  }

  function showList() {
    const saved = savedConversations();
    show(
      tabMine,
      ...(saved.length === 0
        ? [element("p", { class: "muted", text: "Aucune demande envoyée depuis ce navigateur." })]
        : saved.map((item) =>
            element("button", {
              type: "button",
              class: "link",
              text: item.title,
              onclick: () => showConversation(item.token),
            }),
          )),
    );
  }

  function render(thread, token) {
    const items = thread.requests.map((request) =>
      element(
        "div",
        { class: "request" },
        element("strong", { text: request.reference + " · " + request.title }),
        element("p", { class: "muted", text: request.status }),
      ),
    );
    for (const message of thread.messages) {
      const bubble = element("div", {
        class: "bubble " + (message.fromAgent ? "agent" : "mine"),
        text: message.text,
      });
      if (message.attachments.length > 0) {
        bubble.append(
          element("p", { class: "muted", text: "Pièces jointes : " + message.attachments.join(", ") }),
        );
      }
      items.push(bubble);
    }
    if (thread.waiting) {
      items.push(
        element("p", {
          class: "muted",
          text: "L'agent traite votre message. Cela peut prendre quelques minutes.",
        }),
      );
    } else {
      const url = base + "/widget/conversations/" + token + "/messages";
      items.push(messageForm([], "Répondre", url, () => ({})));
    }
    return items;
  }

  async function showConversation(token) {
    try {
      const response = await fetch(base + "/widget/conversations/" + token);
      if (!response.ok) {
        throw new Error("Cette conversation est introuvable.");
      }
      const thread = await response.json();
      show(tabMine, ...render(thread, token));
      if (thread.waiting) {
        poll = setTimeout(() => showConversation(token), pollMs);
      }
    } catch (failure) {
      show(tabMine, element("p", { class: "error", text: failure.message }));
    }
  }

  launcher.addEventListener("click", () => {
    panel.toggleAttribute("hidden");
    if (!panel.hasAttribute("hidden") && body.childElementCount === 0) {
      showForm();
    }
  });
  tabNew.addEventListener("click", showForm);
  tabMine.addEventListener("click", showList);
  document.body.append(host);
})();
`;
