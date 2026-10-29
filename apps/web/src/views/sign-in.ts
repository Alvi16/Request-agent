import { html } from "hono/html";

import { type Fragment, page } from "./layout.ts";

export function signInPage(error?: string, email = ""): Fragment {
  return page(
    "Connexion",
    html`<form class="sign-in" method="post" action="/login">
      <h1>Demandes · connexion</h1>
      ${error === undefined ? "" : html`<p class="error" role="alert">${error}</p>`}
      <label>
        E-mail
        <input type="email" name="email" value="${email}" autocomplete="username" required />
      </label>
      <label>
        Mot de passe
        <input type="password" name="password" autocomplete="current-password" required />
      </label>
      <button class="primary" type="submit">Se connecter</button>
    </form>`,
  );
}
