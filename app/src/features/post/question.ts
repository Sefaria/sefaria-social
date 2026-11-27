/**
 * Whether a post's text is a question (spec 060 AC-006): it ends with a question mark, allowing trailing spaces and closing
 * quotes or brackets. Pure, so the label and its test agree.
 */
export function isQuestion(text: string): boolean {
  return /[?？؟][\s"'”’»)\]]*$/u.test(text.trim());
}
