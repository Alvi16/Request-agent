// Wraps text written by someone outside the system in a tag, so a model can tell it apart from its
// instructions. Tags of the same name inside the text are removed until none is left, since removing
// one can join the pieces of another, so the text cannot close the wrapper early.
export function wrapUntrusted(text: string, tag = "message"): string {
  const pattern = new RegExp(`</?${tag}\\b[^>]*>`, "gi");
  let content = text;
  let previous;
  do {
    previous = content;
    content = content.replaceAll(pattern, "");
  } while (content !== previous);
  return `<${tag}>\n${content}\n</${tag}>`;
}
