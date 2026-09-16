/**
 * A cross inside a text field - the "x" of a search box, made ours (the
 * panel's second round, block 3): one component for the look-up field and
 * the saved-phrases list's filter, so the two fields look and behave the
 * same empty and filled. Our own rather than the browser's, because
 * Firefox draws none on a search field and Chromium's is a small target
 * that fires no event a page can count on.
 *
 * The field is wrapped in place, and the cross stands inside the wrapper
 * at the field's far end (`.clear-field`, `.clear-field-x` in
 * assets/page.css), hidden while there is nothing to clear. A press
 * empties the field, tells the home (which takes its answer or its filter
 * down), and keeps the caret in the field for the next word. The home
 * that fills the field by script calls `refresh`, so the cross follows.
 *
 * @param {HTMLInputElement} input a field already in the document
 * @param {{ label: string, onClear: () => void }} of the cross's accessible
 *   name, and what the home does once the field is empty
 * @returns {{ refresh: () => void }} the cross shown or hidden by what the
 *   field holds - for a value set by script, which fires no `input`
 */
export function clearableField(input, { label, onClear }) {
  const field = document.createElement("div");
  field.className = "clear-field";
  input.replaceWith(field);
  field.append(input);

  const cross = document.createElement("button");
  cross.type = "button";
  cross.className = "clear-field-x";
  cross.textContent = String.fromCodePoint(0x00d7);
  cross.setAttribute("aria-label", label);
  cross.title = label;
  field.append(cross);

  const refresh = () => {
    cross.hidden = input.value.length === 0;
  };
  refresh();

  input.addEventListener("input", refresh);
  cross.addEventListener("click", () => {
    input.value = "";
    refresh();
    onClear();
    input.focus();
  });

  return { refresh };
}
