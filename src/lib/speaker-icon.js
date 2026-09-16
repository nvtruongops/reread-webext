/**
 * The speaker, the bubble's own drawing (`speakerIcon` in
 * `content/tooltip.js`) by the same DOM calls, for the extension's own pages:
 * the saved-phrases rows and the look-up field (D197). The bubble keeps its
 * own copy on purpose - `tooltip.js` has to stay self-sufficient inside its
 * shadow root - and this is the copy the pages share, now that two of them
 * draw it. `currentColor` hands the icon the quiet button's text color, so
 * its resting, hover and focus states are already handled by the button's
 * own rules.
 *
 * @returns {SVGSVGElement}
 */
export function speakerIcon() {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  // Decoration to assistive tech - the button's aria-label carries the words.
  svg.setAttribute("aria-hidden", "true");

  const body = document.createElementNS(NS, "path");
  body.setAttribute("d", "M4 9.5v5h3.2L12 18.6V5.4L7.2 9.5H4z");
  body.setAttribute("fill", "currentColor");
  svg.append(body);

  for (const arc of ["M15 9.2a4.4 4.4 0 0 1 0 5.6", "M17.6 6.8a8 8 0 0 1 0 10.4"]) {
    const wave = document.createElementNS(NS, "path");
    wave.setAttribute("d", arc);
    wave.setAttribute("fill", "none");
    wave.setAttribute("stroke", "currentColor");
    wave.setAttribute("stroke-width", "1.8");
    wave.setAttribute("stroke-linecap", "round");
    svg.append(wave);
  }
  return svg;
}
