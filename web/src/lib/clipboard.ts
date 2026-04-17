/**
 * Copy text to clipboard with fallback for non-secure contexts and
 * Radix Dialog focus-trap (which steals focus from temporary textareas
 * appended to document.body).
 *
 * @param text      The text to copy.
 * @param inputRef  Optional ref to an existing input element inside the
 *                  dialog that already displays the text. This is the
 *                  preferred fallback because it stays within the
 *                  focus-trap boundary.
 */
export async function copyToClipboard(
  text: string,
  inputRef?: React.RefObject<HTMLInputElement | null>
): Promise<boolean> {
  // 1. Modern API (requires secure context — HTTPS or localhost).
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    /* fall through */
  }
  // 2. Fallback: select the existing in-dialog input that already shows the URL.
  if (inputRef?.current) {
    try {
      const el = inputRef.current
      el.focus()
      el.setSelectionRange(0, el.value.length)
      const ok = document.execCommand('copy')
      return ok
    } catch {
      /* fall through */
    }
  }
  // 3. Last resort: temporary textarea (may fail inside a focus-trapped dialog).
  try {
    const el = document.createElement('textarea')
    el.value = text
    el.style.cssText = 'position:fixed;top:-9999px;left:-9999px;'
    document.body.appendChild(el)
    el.focus()
    el.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(el)
    return ok
  } catch {
    return false
  }
}
