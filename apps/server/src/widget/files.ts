// What a message of the widget can carry, so the widget cannot fill the disk.
export const maxFiles = 3;
export const maxFileBytes = 5 * 1024 * 1024;

export interface AcceptedFile {
  filename: string;
  // Read from the first bytes of the file, never from what the browser declared.
  contentType: string;
  bytes: Uint8Array;
}

const signatures: { contentType: string; bytes: number[] }[] = [
  { contentType: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { contentType: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  { contentType: "application/pdf", bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] },
];

function startsWith(bytes: Uint8Array, prefix: number[]): boolean {
  return prefix.every((value, index) => bytes[index] === value);
}

// Plain text: valid UTF-8 without the null bytes binary files have.
function isText(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) {
    return false;
  }
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

function contentTypeOf(bytes: Uint8Array): string | undefined {
  const known = signatures.find((signature) => startsWith(bytes, signature.bytes));
  if (known !== undefined) {
    return known.contentType;
  }
  return isText(bytes) ? "text/plain" : undefined;
}

// Keeps the name readable but harmless: no path, no control character.
function safeName(name: string): string {
  const base = name.split(/[/\\]/).at(-1) ?? "";
  const cleaned = base
    .replaceAll(/[\p{Cc}"]/gu, "")
    .trim()
    .slice(0, 200);
  return cleaned === "" ? "fichier" : cleaned;
}

// The files of a form, or undefined when one of them is refused: too many, too large, empty, or
// of a type other than PNG, JPEG, PDF or plain text.
export async function acceptFiles(values: unknown[]): Promise<AcceptedFile[] | undefined> {
  if (values.length > maxFiles || values.some((value) => !(value instanceof File))) {
    return undefined;
  }
  const files = values.filter((value) => value instanceof File);
  if (files.some((file) => file.size === 0 || file.size > maxFileBytes)) {
    return undefined;
  }
  const accepted = await Promise.all(
    files.map(async (file) => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const contentType = contentTypeOf(bytes);
      return contentType === undefined
        ? undefined
        : { filename: safeName(file.name), contentType, bytes };
    }),
  );
  return accepted.every((file) => file !== undefined) ? accepted : undefined;
}
