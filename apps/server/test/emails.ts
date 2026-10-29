import { createTransport } from "nodemailer";
import type Mail from "nodemailer/lib/mailer";

// Builds the raw source of an email, exactly as a mail server would deliver it.
const composer = createTransport({ streamTransport: true, buffer: true, newline: "unix" });

export async function rawEmail(options: Mail.Options): Promise<Uint8Array> {
  const built = await composer.sendMail({
    from: "Alice Martin <alice.martin@acme.example>",
    to: "agent@requests.example",
    subject: "Bouton de validation cassé",
    text: "Le bouton de validation ne fonctionne plus.",
    ...options,
  });
  const { message } = built;
  if (!Buffer.isBuffer(message)) {
    throw new Error("The email was not built as a buffer");
  }
  return message;
}
