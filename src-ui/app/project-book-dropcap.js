// As in the PDF (gnosis-dropcap-lines), a drop cap falls as many lines as its
// paragraph has, up to three, and a one-line paragraph takes none. Lines are
// counted on the mounted page with the cap set inline, so at the full width,
// against probe paragraphs of one and two lines. The count is a data attribute
// the stylesheet sizes the cap by; rendered HTML always carries the three-line cap.
export const BOOK_DROPCAP_LINES_ATTRIBUTE = "data-book-dropcap-lines";

export function sizeBookDropcaps(root) {
  for (const paragraph of root.querySelectorAll(".book-page--chapter .book-print-dropcap")) {
    const previous = paragraph.getAttribute(BOOK_DROPCAP_LINES_ATTRIBUTE);
    paragraph.setAttribute(BOOK_DROPCAP_LINES_ATTRIBUTE, "1");
    const probe = paragraph.cloneNode(false);
    probe.setAttribute("aria-hidden", "true");
    paragraph.after(probe);
    probe.textContent = "X";
    const one = probe.offsetHeight;
    probe.innerHTML = "X<br>X";
    const two = probe.offsetHeight;
    probe.remove();
    // A hidden preview has no layout to count; keep the cap it had.
    if (!one) {
      if (previous) paragraph.setAttribute(BOOK_DROPCAP_LINES_ATTRIBUTE, previous);
      else paragraph.removeAttribute(BOOK_DROPCAP_LINES_ATTRIBUTE);
      continue;
    }
    const height = paragraph.offsetHeight;
    const slack = parseFloat(getComputedStyle(paragraph).fontSize) / 2;
    paragraph.setAttribute(BOOK_DROPCAP_LINES_ATTRIBUTE, height <= one + slack ? "1" : height <= two + slack ? "2" : "3");
  }
}
