import { describe, expect, it } from "vitest";

import { acceptFiles, maxFileBytes } from "./files";

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const pdf = new TextEncoder().encode("%PDF-1.7\n...");

describe("acceptFiles", () => {
  it("reads the type from the content, not from what the browser declared", async () => {
    const files = await acceptFiles([
      new File([png], "capture.png", { type: "text/html" }),
      new File([pdf], "devis.pdf"),
      new File(["Erreur 500 à 9 h"], "journal.txt"),
    ]);

    expect(files?.map((file) => [file.filename, file.contentType])).toEqual([
      ["capture.png", "image/png"],
      ["devis.pdf", "application/pdf"],
      ["journal.txt", "text/plain"],
    ]);
  });

  it("accepts a message without files", async () => {
    expect(await acceptFiles([])).toEqual([]);
  });

  it("refuses another type, an empty or too large file, too many files, or a field that is no file", async () => {
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0]);
    const refused = [
      [new File([zip], "archive.zip")],
      [new File([], "vide.png")],
      [new File([new Uint8Array(maxFileBytes + 1)], "gros.png")],
      [1, 2, 3, 4].map((i) => new File([png], `${i}.png`)),
      ["texte"],
    ];

    expect(await Promise.all(refused.map(acceptFiles))).toEqual(refused.map(() => undefined));
  });

  it("keeps only the base of a name, without control characters", async () => {
    const [file] = (await acceptFiles([new File([png], '../../etc/"x\u0007.png')])) ?? [];

    expect(file?.filename).toBe("x.png");
  });
});
