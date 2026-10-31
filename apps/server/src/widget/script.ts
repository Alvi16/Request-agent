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
  // The limits of the server, shown before sending so a person does not pick a fourth file.
  const maxFiles = 3;
  const svgNamespace = "http://www.w3.org/2000/svg";

  // Drawn with strokes of the text color, on a 24 by 24 grid.
  const icons = {
    chat: "M4 5h16v11H9l-5 4z",
    close: "M6 6l12 12M18 6L6 18",
    question: "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.5v.7M12 17v.01",
    bug: "M8 10a4 4 0 0 1 8 0v4a4 4 0 0 1-8 0zM4 12h4M16 12h4M5 6l3 2.5M19 6l-3 2.5M5 18l3-2M19 18l-3-2",
    idea: "M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5.5 1.1.5 2.1h6c0-1-.1-1.6.5-2.1A6 6 0 0 0 12 3z",
    clip: "M20 11l-8 8a5 5 0 0 1-7-7l8-8a3.3 3.3 0 0 1 4.7 4.7l-8 8a1.6 1.6 0 0 1-2.3-2.3l7.3-7.3",
    screen: "M3 4h18v12H3zM8 20h8M12 16v4",
    file: "M6 3h8l4 4v14H6zM14 3v4h4",
    send: "M4 12l16-8-6 16-3-6z",
    back: "M15 6l-6 6 6 6",
    next: "M9 6l6 6-6 6",
  };

  const kinds = [
    ["QUESTION", "Question", "question", "Posez votre question…"],
    ["BUG", "Bug", "bug", "Décrivez ce qui ne fonctionne pas, et ce que vous attendiez…"],
    ["EVOLUTION", "Évolution", "idea", "Décrivez ce que vous aimeriez pouvoir faire…"],
  ];

  // The status of a request, by its code: a short label and the color of its badge.
  const statuses = {
    NEW: ["Enregistrée", "blue"],
    IN_PROGRESS: ["En cours", "amber"],
    WAITING_FOR_INFO: ["En attente de vos informations", "orange"],
    RESOLVED: ["Résolue", "green"],
    CLOSED: ["Clôturée", "gray"],
  };

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

  function icon(name) {
    const svg = document.createElementNS(svgNamespace, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("class", "icon");
    const path = document.createElementNS(svgNamespace, "path");
    path.setAttribute("d", icons[name]);
    svg.append(path);
    return svg;
  }

  function fileSize(bytes) {
    return bytes < 1024 * 1024
      ? Math.max(1, Math.round(bytes / 1024)) + " Ko"
      : (bytes / 1024 / 1024).toFixed(1).replace(".", ",") + " Mo";
  }

  const timeFormat = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const dayFormat = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" });
  function when(iso) {
    const date = new Date(iso);
    const time = timeFormat.format(date);
    return date.toDateString() === new Date().toDateString()
      ? time
      : dayFormat.format(date) + ", " + time;
  }

  const css = [
    ":host { all: initial; }",
    "* { box-sizing: border-box; font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }",
    ".icon { width: 18px; height: 18px; flex: none; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }",
    "button { font: inherit; cursor: pointer; }",
    "button:focus-visible, input:focus-visible, textarea:focus-visible, .kind input:focus-visible + span { outline: 3px solid rgba(108,92,231,.45); outline-offset: 2px; }",
    ".launcher span { display: flex; }",
    ".launcher { position: fixed; right: 20px; bottom: 20px; z-index: 2147483647; display: flex; align-items: center; gap: 8px; border: none; border-radius: 999px; padding: 13px 20px; background: linear-gradient(135deg, #7c6cf0, #5b4bd5); color: #fff; font-size: 15px; font-weight: 600; box-shadow: 0 8px 24px rgba(91,75,213,.4); transition: transform .15s ease, box-shadow .15s ease; }",
    ".launcher:hover { transform: translateY(-2px); box-shadow: 0 12px 28px rgba(91,75,213,.5); }",
    ".panel { position: fixed; right: 20px; bottom: 84px; z-index: 2147483647; width: 380px; max-width: calc(100vw - 32px); height: 600px; max-height: calc(100vh - 110px); display: flex; flex-direction: column; background: #fff; color: #1f1d2b; border-radius: 20px; box-shadow: 0 20px 60px rgba(20,16,50,.28); overflow: hidden; font-size: 14px; line-height: 1.45; animation: rise .18s ease-out; }",
    ".panel[hidden] { display: none; }",
    "@keyframes rise { from { opacity: 0; transform: translateY(12px); } }",
    ".top { padding: 18px 18px 0; background: linear-gradient(135deg, #7c6cf0, #5b4bd5); color: #fff; }",
    ".title { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }",
    "h2 { margin: 0; font-size: 18px; font-weight: 700; }",
    ".title p { margin: 4px 0 0; font-size: 13px; opacity: .85; }",
    ".close { display: grid; place-items: center; width: 32px; height: 32px; border: none; border-radius: 10px; background: rgba(255,255,255,.15); color: #fff; }",
    ".close:hover { background: rgba(255,255,255,.28); }",
    ".tabs { display: flex; gap: 4px; margin-top: 16px; }",
    ".tabs button { flex: 1; border: none; border-radius: 12px 12px 0 0; padding: 10px; background: transparent; color: rgba(255,255,255,.85); font-size: 14px; font-weight: 600; }",
    ".tabs button:hover { color: #fff; }",
    ".tabs button[aria-pressed=true] { background: #fff; color: #5b4bd5; }",
    ".body { flex: 1; padding: 16px 18px 18px; overflow-y: auto; display: flex; flex-direction: column; gap: 14px; }",
    "form { display: flex; flex-direction: column; gap: 14px; }",
    "fieldset { margin: 0; padding: 0; border: none; }",
    "legend, .field { font-size: 13px; font-weight: 600; color: #4a4760; }",
    "legend { margin-bottom: 8px; }",
    ".field { display: flex; flex-direction: column; gap: 6px; }",
    ".kinds { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }",
    ".kind { position: relative; }",
    ".kind input { position: absolute; opacity: 0; pointer-events: none; }",
    ".kind > span { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 12px 6px; border: 1.5px solid #e4e2ee; border-radius: 12px; color: #4a4760; font-size: 13px; font-weight: 600; cursor: pointer; transition: border-color .15s ease, background .15s ease; }",
    ".kind > span:hover { border-color: #b9b1f5; }",
    ".kind > input:checked + span { border-color: #6c5ce7; background: #f3f1fe; color: #5b4bd5; }",
    ".kind .icon { width: 22px; height: 22px; }",
    "input, textarea { width: 100%; font: inherit; font-size: 14px; font-weight: 400; color: #1f1d2b; padding: 10px 12px; background: #fafafc; border: 1.5px solid #e4e2ee; border-radius: 12px; }",
    "input:focus, textarea:focus { outline: none; border-color: #6c5ce7; background: #fff; box-shadow: 0 0 0 3px rgba(108,92,231,.15); }",
    "textarea { min-height: 110px; resize: vertical; }",
    ".reply textarea { min-height: 46px; height: 46px; }",
    ".files { display: flex; flex-direction: column; gap: 8px; padding: 10px; border: 1.5px dashed #d7d4e6; border-radius: 12px; transition: border-color .15s ease, background .15s ease; }",
    ".files.dragging { border-color: #6c5ce7; background: #f3f1fe; }",
    ".row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }",
    ".secondary { display: inline-flex; align-items: center; justify-content: center; gap: 6px; border: 1px solid #e4e2ee; border-radius: 10px; padding: 7px 11px; background: #fff; color: #4a4760; font-size: 13px; font-weight: 600; }",
    ".secondary:hover:not(:disabled) { border-color: #b9b1f5; color: #5b4bd5; }",
    ".secondary:disabled { opacity: .5; cursor: not-allowed; }",
    ".secondary .icon { width: 16px; height: 16px; }",
    ".hint { margin: 0; color: #77748a; font-size: 12px; }",
    ".chips { display: flex; flex-direction: column; gap: 6px; margin: 0; padding: 0; list-style: none; }",
    ".chips:empty { display: none; }",
    ".chip { display: flex; align-items: center; gap: 8px; padding: 6px 8px; background: #f3f1fe; border-radius: 10px; color: #4a4760; font-size: 13px; }",
    ".chip .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }",
    ".chip .size { color: #77748a; font-size: 12px; }",
    ".chip button { display: grid; place-items: center; width: 24px; height: 24px; border: none; border-radius: 8px; background: transparent; color: #77748a; }",
    ".chip button:hover { background: #e6e2fd; color: #b3261e; }",
    ".chip button .icon { width: 14px; height: 14px; }",
    ".primary { display: flex; align-items: center; justify-content: center; gap: 8px; border: none; border-radius: 12px; padding: 12px 16px; background: linear-gradient(135deg, #7c6cf0, #5b4bd5); color: #fff; font-size: 15px; font-weight: 600; }",
    ".primary:hover:not(:disabled) { filter: brightness(1.07); }",
    ".primary:disabled { opacity: .65; cursor: wait; }",
    ".error { margin: 0; padding: 8px 10px; border-radius: 10px; background: #fdecea; color: #b3261e; font-size: 13px; }",
    ".error:empty { display: none; }",
    ".back { display: inline-flex; align-items: center; gap: 4px; align-self: flex-start; border: none; padding: 0; background: none; color: #5b4bd5; font-size: 13px; font-weight: 600; }",
    ".back .icon { width: 16px; height: 16px; }",
    ".requests { position: sticky; top: -16px; z-index: 1; display: flex; flex-direction: column; gap: 8px; margin: -16px -18px 0; padding: 16px 18px 10px; background: linear-gradient(#fff 85%, rgba(255,255,255,0)); }",
    ".request { display: flex; flex-direction: column; gap: 6px; padding: 12px 14px; border: 1px solid #ebe9f3; border-radius: 14px; background: #fafafc; }",
    ".request .line { display: flex; align-items: center; justify-content: space-between; gap: 8px; }",
    ".ref { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; font-weight: 600; color: #5b4bd5; }",
    ".request strong { font-size: 14px; }",
    ".badge { padding: 3px 9px; border-radius: 999px; font-size: 12px; font-weight: 600; white-space: nowrap; }",
    ".badge-blue { background: #e7f0fe; color: #1a5fc4; }",
    ".badge-amber { background: #fdf3dc; color: #8a5a00; }",
    ".badge-orange { background: #fdebdd; color: #a3460e; }",
    ".badge-green { background: #e3f6e9; color: #1d7a3e; }",
    ".badge-gray { background: #eeedf3; color: #55526a; }",
    ".thread { display: flex; flex-direction: column; gap: 12px; }",
    ".message { display: flex; flex-direction: column; gap: 4px; max-width: 85%; }",
    ".message.mine { align-self: flex-end; align-items: flex-end; }",
    ".message.agent { align-self: flex-start; }",
    ".meta { color: #77748a; font-size: 12px; }",
    ".bubble { padding: 10px 13px; border-radius: 16px; white-space: pre-wrap; overflow-wrap: anywhere; }",
    ".mine .bubble { background: linear-gradient(135deg, #7c6cf0, #5b4bd5); color: #fff; border-bottom-right-radius: 5px; }",
    ".agent .bubble { background: #f1f0f6; color: #1f1d2b; border-bottom-left-radius: 5px; }",
    ".message .chips { align-items: inherit; }",
    ".message .chip { background: #f6f5fa; }",
    ".typing { display: flex; gap: 4px; align-self: flex-start; padding: 14px 16px; }",
    ".typing span { width: 7px; height: 7px; border-radius: 50%; background: #9a96b0; animation: blink 1.2s infinite ease-in-out; }",
    ".typing span:nth-child(2) { animation-delay: .2s; }",
    ".typing span:nth-child(3) { animation-delay: .4s; }",
    "@keyframes blink { 0%, 80%, 100% { opacity: .3; transform: translateY(0); } 40% { opacity: 1; transform: translateY(-3px); } }",
    ".footer { padding: 12px 18px 14px; border-top: 1px solid #ebe9f3; background: #fff; }",
    ".footer:empty { display: none; }",
    ".reply { display: grid; grid-template-columns: 1fr auto; align-items: end; gap: 8px; }",
    ".reply textarea, .reply .error { grid-column: 1 / -1; }",
    ".reply .error { order: 1; }",
    ".reply .files { padding: 0; border: none; }",
    ".reply .files.dragging { padding: 6px; }",
    ".reply .row { display: flex; }",
    ".reply .secondary { padding: 8px; }",
    ".reply .secondary span, .reply .hint { display: none; }",
    ".reply .primary { padding: 9px 14px; font-size: 14px; }",
    ".list { display: flex; flex-direction: column; gap: 8px; margin: 0; padding: 0; list-style: none; }",
    ".item { display: flex; align-items: center; gap: 10px; width: 100%; padding: 12px 14px; border: 1px solid #ebe9f3; border-radius: 14px; background: #fff; color: #1f1d2b; font-size: 14px; text-align: left; }",
    ".item:hover { border-color: #b9b1f5; background: #faf9ff; }",
    ".item .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }",
    ".item .icon { color: #9a96b0; }",
    ".empty { display: flex; flex-direction: column; align-items: center; gap: 10px; margin: auto 0; padding: 24px 8px; color: #77748a; text-align: center; }",
    ".empty .icon { width: 36px; height: 36px; color: #b9b1f5; }",
    ".empty p { margin: 0; }",
    ".muted { margin: 0; color: #77748a; font-size: 13px; }",
    "@media (max-width: 480px) { .panel { inset: 0; width: auto; max-width: none; height: auto; max-height: none; border-radius: 0; } .launcher { right: 16px; bottom: 16px; } }",
    "@media (prefers-reduced-motion: reduce) { .panel, .typing span { animation: none; } .launcher, .kind > span, .files { transition: none; } .launcher:hover { transform: none; } }",
  ].join("\n");

  const host = element("div");
  const root = host.attachShadow({ mode: "open" });
  const launcherIcon = element("span", {}, icon("chat"));
  const launcherText = element("span", { text: "Besoin d'aide ?" });
  const launcher = element(
    "button",
    { class: "launcher", type: "button", "aria-expanded": "false", "aria-controls": "panel" },
    launcherIcon,
    launcherText,
  );
  const closeButton = element(
    "button",
    { class: "close", type: "button", "aria-label": "Fermer" },
    icon("close"),
  );
  const tabNew = element("button", { type: "button", text: "Nouvelle demande" });
  const tabMine = element("button", { type: "button", text: "Mes demandes" });
  const body = element("div", { class: "body" });
  // Holds the reply of a conversation, below the messages, as in a chat.
  const footer = element("div", { class: "footer" });
  const panel = element(
    "section",
    { id: "panel", class: "panel", hidden: "", role: "dialog", "aria-labelledby": "title" },
    element(
      "div",
      { class: "top" },
      element(
        "div",
        { class: "title" },
        element(
          "div",
          {},
          element("h2", { id: "title", text: "Besoin d'aide ?" }),
          element("p", { text: "Écrivez-nous : l'agent vous répond ici." }),
        ),
        closeButton,
      ),
      element("div", { class: "tabs" }, tabNew, tabMine),
    ),
    body,
    footer,
  );
  root.append(element("style", { text: css }), launcher, panel);

  let poll;
  function show(tab, ...content) {
    clearTimeout(poll);
    tabNew.setAttribute("aria-pressed", String(tab === tabNew));
    tabMine.setAttribute("aria-pressed", String(tab === tabMine));
    body.replaceChildren(...content);
    footer.replaceChildren();
    body.scrollTop = 0;
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

  // The files to send, chosen, captured or dropped on the zone, each with a button to remove it.
  function filePicker(files) {
    const list = element("ul", { class: "chips" });
    const buttons = [];
    const refresh = () => {
      list.replaceChildren(
        ...files.map((file, index) =>
          element(
            "li",
            { class: "chip" },
            icon("file"),
            element("span", { class: "name", text: file.name }),
            element("span", { class: "size", text: fileSize(file.size) }),
            element(
              "button",
              {
                type: "button",
                "aria-label": "Retirer " + file.name,
                onclick: () => {
                  files.splice(index, 1);
                  refresh();
                },
              },
              icon("close"),
            ),
          ),
        ),
      );
      for (const button of buttons) {
        button.disabled = files.length >= maxFiles;
      }
    };
    const add = (chosen) => {
      files.push(...Array.from(chosen).slice(0, maxFiles - files.length));
      refresh();
    };
    const input = element("input", {
      type: "file",
      multiple: "",
      hidden: "",
      accept: "image/png,image/jpeg,application/pdf,text/plain",
      onchange: () => {
        add(input.files);
        input.value = "";
      },
    });
    buttons.push(
      element(
        "button",
        {
          type: "button",
          class: "secondary",
          title: "Joindre un fichier",
          "aria-label": "Joindre un fichier",
          onclick: () => input.click(),
        },
        icon("clip"),
        element("span", { text: "Joindre" }),
      ),
    );
    if (navigator.mediaDevices?.getDisplayMedia !== undefined) {
      buttons.push(
        element(
          "button",
          {
            type: "button",
            class: "secondary",
            title: "Capturer l'écran",
            "aria-label": "Capturer l'écran",
            onclick: async () => {
              try {
                add([await captureScreen()]);
              } catch {
                // The person cancelled the capture.
              }
            },
          },
          icon("screen"),
          element("span", { text: "Capture d'écran" }),
        ),
      );
    }
    const zone = element(
      "div",
      { class: "files" },
      input,
      element("div", { class: "row" }, ...buttons),
      list,
      element("p", {
        class: "hint",
        text: "Ou glissez vos fichiers ici · PNG, JPEG, PDF ou texte, 3 fichiers de 5 Mo au plus",
      }),
    );
    zone.addEventListener("dragover", (event) => {
      event.preventDefault();
      zone.classList.add("dragging");
    });
    zone.addEventListener("dragleave", () => zone.classList.remove("dragging"));
    zone.addEventListener("drop", (event) => {
      event.preventDefault();
      zone.classList.remove("dragging");
      add(event.dataTransfer?.files ?? []);
    });
    return zone;
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
  function messageForm(fields, text, submitText, url, extra, compact = false) {
    const files = [];
    const error = element("p", { class: "error", role: "alert" });
    const submit = element(
      "button",
      { type: "submit", class: "primary" },
      element("span", { text: submitText }),
      icon("send"),
    );
    const form = element(
      "form",
      { class: compact ? "reply" : "" },
      ...fields,
      compact ? text : element("label", { class: "field" }, element("span", { text: "Message" }), text),
    );
    form.append(filePicker(files), error, submit);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      submit.disabled = true;
      submit.firstChild.textContent = "Envoi…";
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
        submit.firstChild.textContent = submitText;
      }
    });
    return form;
  }

  function messageField(placeholder) {
    return element("textarea", {
      required: "",
      maxlength: "5000",
      placeholder,
      "aria-label": "Message",
    });
  }

  function showForm() {
    const text = messageField(kinds[0][3]);
    const choices = kinds.map(([value, label, iconName, placeholder], index) => {
      const radio = element("input", { type: "radio", name: "kind", value });
      radio.checked = index === 0;
      radio.addEventListener("change", () => {
        text.placeholder = placeholder;
      });
      return element(
        "label",
        { class: "kind" },
        radio,
        element("span", {}, icon(iconName), element("span", { text: label })),
      );
    });
    const email = element("input", {
      type: "email",
      required: "",
      maxlength: "254",
      autocomplete: "email",
      placeholder: "vous@exemple.com",
    });
    const fields = [
      element(
        "fieldset",
        {},
        element("legend", { text: "Votre demande" }),
        element("div", { class: "kinds" }, ...choices),
      ),
    ];
    if (!signedIn) {
      fields.push(
        element(
          "label",
          { class: "field" },
          element("span", { text: "Votre adresse e-mail" }),
          email,
        ),
      );
    }
    const identity = () => {
      const chosen = choices.map((choice) => choice.firstChild).find((radio) => radio.checked);
      const values = { kind: chosen?.value ?? kinds[0][0] };
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
    show(tabNew, messageForm(fields, text, "Envoyer", base + "/widget/messages", identity));
  }

  function showList() {
    const saved = savedConversations();
    if (saved.length === 0) {
      show(
        tabMine,
        element(
          "div",
          { class: "empty" },
          icon("chat"),
          element("p", { text: "Aucune demande envoyée depuis ce navigateur." }),
          element("button", {
            type: "button",
            class: "secondary",
            text: "Nouvelle demande",
            onclick: showForm,
          }),
        ),
      );
      return;
    }
    show(
      tabMine,
      element(
        "ul",
        { class: "list" },
        ...saved.map((item) =>
          element(
            "li",
            {},
            element(
              "button",
              { type: "button", class: "item", onclick: () => showConversation(item.token) },
              element("span", { class: "name", text: item.title }),
              icon("next"),
            ),
          ),
        ),
      ),
    );
  }

  function statusBadge(request) {
    const [label, tone] = statuses[request.statusCode] ?? [request.status, "gray"];
    return element("span", { class: "badge badge-" + tone, text: label });
  }

  function attachmentChips(names) {
    return element(
      "ul",
      { class: "chips" },
      ...names.map((name) =>
        element("li", { class: "chip" }, icon("file"), element("span", { class: "name", text: name })),
      ),
    );
  }

  function render(thread, token) {
    const items = [
      element(
        "button",
        { type: "button", class: "back", onclick: showList },
        icon("back"),
        element("span", { text: "Mes demandes" }),
      ),
    ];
    // The requests and their status stay in sight while the messages scroll.
    if (thread.requests.length > 0) {
      items.push(
        element(
          "div",
          { class: "requests" },
          ...thread.requests.map((request) =>
            element(
              "div",
              { class: "request" },
              element(
                "div",
                { class: "line" },
                element("span", { class: "ref", text: request.reference }),
                statusBadge(request),
              ),
              element("strong", { text: request.title }),
            ),
          ),
        ),
      );
    }
    const messages = thread.messages.map((message) =>
      element(
        "div",
        { class: "message " + (message.fromAgent ? "agent" : "mine") },
        element("span", {
          class: "meta",
          text: (message.fromAgent ? "Agent" : "Vous") + " · " + when(message.sentAt),
        }),
        element("div", { class: "bubble", text: message.text }),
        attachmentChips(message.attachments),
      ),
    );
    if (thread.waiting) {
      messages.push(
        element(
          "div",
          { class: "message agent", role: "status" },
          element("span", { class: "meta", text: "L'agent prépare sa réponse…" }),
          element(
            "div",
            { class: "bubble typing" },
            element("span"),
            element("span"),
            element("span"),
          ),
          element("p", { class: "muted", text: "Cela peut prendre quelques minutes." }),
        ),
      );
    }
    items.push(element("div", { class: "thread" }, ...messages));
    if (thread.waiting) {
      return { items, reply: [] };
    }
    const url = base + "/widget/conversations/" + token + "/messages";
    const reply = messageForm([], messageField("Votre réponse…"), "Répondre", url, () => ({}), true);
    return { items, reply: [reply] };
  }

  async function showConversation(token) {
    try {
      const response = await fetch(base + "/widget/conversations/" + token);
      if (!response.ok) {
        throw new Error("Cette conversation est introuvable.");
      }
      const thread = await response.json();
      const { items, reply } = render(thread, token);
      show(tabMine, ...items);
      footer.replaceChildren(...reply);
      // The latest messages are at the bottom, above the reply.
      body.scrollTop = body.scrollHeight;
      if (thread.waiting) {
        poll = setTimeout(() => showConversation(token), pollMs);
      }
    } catch (failure) {
      show(tabMine, element("p", { class: "error", text: failure.message }));
    }
  }

  function setOpen(open) {
    panel.toggleAttribute("hidden", !open);
    launcher.setAttribute("aria-expanded", String(open));
    launcherIcon.replaceChildren(icon(open ? "close" : "chat"));
    launcherText.textContent = open ? "Fermer" : "Besoin d'aide ?";
    if (open && body.childElementCount === 0) {
      showForm();
    }
  }

  launcher.addEventListener("click", () => setOpen(panel.hasAttribute("hidden")));
  closeButton.addEventListener("click", () => {
    setOpen(false);
    launcher.focus();
  });
  panel.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      setOpen(false);
      launcher.focus();
    }
  });
  tabNew.addEventListener("click", showForm);
  tabMine.addEventListener("click", showList);
  document.body.append(host);
})();
`;
