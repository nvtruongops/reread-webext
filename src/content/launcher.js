/**
 * Reader-only mode's whole footprint on an ordinary page: a selection shows
 * two doors - "Read in the reader", and the reading list beside it - and
 * nothing else happens. No scan, no underlines, no observer, and nothing ever
 * goes to the engine; the reader is where all of that lives in this mode. The
 * bubble is the same shadow-rooted tooltip the reading side uses, in a variant
 * that is that row under the extension's name (D126), so its isolation and its
 * lifecycle are the ones already paid for - and so an offer appearing unbidden
 * over somebody else's page says whose it is and where it leads.
 *
 * The second door (D129) is there because on Android this bubble is the
 * shortest way into the extension there is: Fenix gives an add-on no context
 * menu, no toolbar of its own and no share target, so everything else starts
 * with the browser's own menu. A hold on any word already opened the page
 * being read; the same hold now also opens what was read before, without
 * going through the page at all. Since D182 it is a door in its own right:
 * the plain label it began as read as a caption under the offer, and a room
 * nobody could see the door to was a room nobody entered. The two are one
 * component told apart by weight - the door into this page filled, the door
 * into the list outlined - so the bubble reads as a menu of two ways in, and
 * the hierarchy is still said. Escape puts the menu away, and on a touch
 * selection it stands under the phrase rather than over it, clear of the
 * system's floating bar.
 *
 * The selection is listened for through `selectionchange` with a settle timer,
 * not through the mouse gesture the reading side reads (D47). That is not a
 * disagreement with D47 but its terms not applying: on Android a selection is
 * made with the system's own handles, which end in no mouse gesture at all -
 * `selectionchange` is the one signal every way of selecting produces. What
 * made the event unusable over there was answering mid-drag with an engine run
 * per answer; here answering costs a bubble and the timer waits for the
 * selection to hold still, so the storm a drag produces collapses into one
 * showing. The timer only ever runs while a selection is being made - at rest
 * this module is a listener for the selection, one for scroll, and on a
 * touch-capable device one remembering the pointer's type (D74), and nothing
 * else.
 *
 * What the presses send is in `onAction` below; the short of it is that a
 * content script does not know which tab it is, and does not have to.
 */

import { webext } from "../lib/browser.js";
import { t } from "../lib/i18n.js";
import { Message } from "../lib/protocol.js";
import { touchPointer } from "../lib/selection.js";
import { createTooltip } from "./tooltip.js";

/**
 * How long a selection has to hold still before the offer appears. Long enough
 * to outlast the `selectionchange` storm of a drag or a handle being moved,
 * short enough that nobody waits on it: the offer is not an answer somebody
 * asked for, it may arrive a beat after the gesture.
 */
const SETTLE_MS = 300;

const tooltip = createTooltip({ onAction, onHide: onOfferHidden });

/** @type {number | null} */
let timer = null;
let started = false;
/** The last press's pointer type: a finger's selection wears the system's
 *  bar and handles around it, and the offer stands a system strip away from
 *  it (D74). Only ever set where a finger can select - a mouse-only device
 *  does not pay for the listener. */
let lastPointerType = "";
/** The selection the offer is standing under, to stand aside when it moves. */
let shownText = "";
/**
 * The bubble-size knob as a plain factor (D85). This module deliberately
 * listens to nothing at rest, so it does not watch storage either -
 * `content/index.js` already does, owns the config, and hands the value down
 * through `setLauncherScale` on every settings change.
 */
let scale = 1;
/**
 * Whether the offer should add that translation needs a model first (a fresh
 * install selecting on a page would otherwise learn it only at the end of the
 * road, in the reader's own bubble). Decided upstairs: `content/index.js`
 * owns the settings and the published inventory, and hands the verdict down
 * the way it hands the scale - this module still listens to nothing at rest.
 */
let modelHint = false;
/** Whether the Escape listener stands - only ever while the offer does. */
let escapeListening = false;

/**
 * @param {number} factor `1` means "as designed"
 */
export function setLauncherScale(factor) {
  scale = factor;
}

/**
 * @param {boolean} needed
 */
export function setLauncherHint(needed) {
  modelHint = needed;
}

/**
 * Both doors send one message and wait for nothing: there is nothing here to
 * render, and the reader tab coming forward is its own confirmation. A
 * background mid-restart means a press that did nothing, and pressing again
 * is the repair.
 *
 * `open-reader` goes without a tab id on purpose (the background reads it off
 * the sender); `open-library` carries nothing at all, because the list is
 * about no tab - the same message the popup's row sends.
 *
 * @param {import("./tooltip.js").ReportedAction} action
 */
function onAction(action) {
  const kind =
    action === "reader"
      ? Message.OPEN_READER
      : action === "library"
        ? Message.OPEN_LIBRARY
        : action === "settings"
          ? Message.OPEN_SETTINGS
          : null;
  if (kind === null) return;
  try {
    void webext()
      .runtime.sendMessage({ kind })
      .catch(() => {});
  } catch {
    // No runtime in this context anymore - the extension was reloaded under
    // the page. Nothing to do that reloading the page will not fix.
  }
  tooltip.hide();
}

/**
 * Escape puts the offer away (D182), listened for only while it stands: the
 * module keeps its rest silent, and the key that means "not this" has to
 * reach a bubble whose doors the keyboard can tab into. The selection stays
 * what it is - the offer comes back with the next change to it - and the key
 * is not claimed: a page that answers Escape itself keeps its answer.
 *
 * @param {KeyboardEvent} event
 */
function onKeyDown(event) {
  if (event.key === "Escape") tooltip.hide();
}

function listenForEscape() {
  if (escapeListening) return;
  escapeListening = true;
  document.addEventListener("keydown", onKeyDown, { capture: true });
}

/** The offer went away, by whichever door: the key listener goes with it. */
function onOfferHidden() {
  if (!escapeListening) return;
  escapeListening = false;
  document.removeEventListener("keydown", onKeyDown, { capture: true });
}

/**
 * The selection as it stands once it has held still, turned into the offer or
 * into the bubble going away. Reading the document's state rather than a
 * gesture is safe here for the reason the module comment gives: showing this
 * bubble twice costs nothing anybody can see.
 */
function settle() {
  timer = null;

  const selection = window.getSelection();
  if (selection === null || selection.isCollapsed || selection.rangeCount === 0) {
    tooltip.hide();
    return;
  }
  const text = selection.toString().trim();
  if (text.length === 0) {
    tooltip.hide();
    return;
  }

  const rect = selection.getRangeAt(0).getBoundingClientRect();
  // A selection inside a collapsed or hidden element measures as nothing, and
  // a bubble anchored to nothing lands in the corner of the screen.
  if (rect.width === 0 && rect.height === 0) {
    tooltip.hide();
    return;
  }

  shownText = text;
  tooltip.show({
    anchor: rect,
    variant: "launcher",
    // With no model to translate with, the offer says so here rather than at
    // the end of the road in the reader's bubble - the same sentence, the
    // same tone and the same way out (the settings door) that bubble uses,
    // so the first selection after a fresh install meets the answer once.
    body: modelHint ? t("error_model_missing") : "",
    tone: modelHint ? "error" : "normal",
    // With the hint on, the sentence above points at the settings - so the
    // settings door stands directly under it, the reading-bubble error's own
    // order, then the reader offer, and the quiet library label closes the
    // column. The first cut had the quiet label between two framed buttons,
    // which read as three unrelated things (Michał's report, 0.5.12 on
    // Android); the order is his too.
    actions: modelHint ? ["settings", "reader", "library"] : ["reader", "library"],
    // A pen's selection wears the same system bar and handles (D80).
    touch: touchPointer(lastPointerType),
    // Under the phrase on a touch selection (D182): the system's floating bar
    // (Copy, Search) hovers over the phrase, and the offer standing above it
    // had the bar over its own foot (Michał's screenshot from a Pixel);
    // under the phrase there are only the drag handles, which the strip
    // steps past. The same pointer memory as `touch`, not a media query -
    // the query lies on e-ink (D84).
    below: touchPointer(lastPointerType),
    // The same pointer also sizes the row for the finger about to press it
    // (D84) - the media query alone answers wrong on some devices.
    coarse: touchPointer(lastPointerType),
    scale,
  });
  listenForEscape();
}

function onSelectionChange() {
  if (timer !== null) window.clearTimeout(timer);
  timer = window.setTimeout(settle, SETTLE_MS);

  // The offer stands aside the moment the selection under it moves again
  // (D75): dragging a system handle sends the page no pointer event, so the
  // selection changing is the whole signal, and an offer left standing covers
  // the words the handle is heading for. A ghost change - the system's
  // toolbar poking a selection that did not move - carries the same text and
  // falls through; a collapse is the timer's business, as it always was.
  if (!tooltip.isOpen()) return;
  const selection = window.getSelection();
  if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return;
  if (selection.toString().trim() === shownText) return;
  tooltip.hide();
}

/**
 * @param {PointerEvent} event
 */
function onPointerDown(event) {
  // A page's own script can dispatch one of these; only the browser's count
  // (D171, the reading side's rule). `selectionchange` stays ungated - the
  // offer this module makes is only ever an offer.
  if (event.isTrusted !== true) return;
  lastPointerType = event.pointerType;
}

/**
 * @param {Event} event
 */
function onScroll(event) {
  // The bubble is anchored to viewport coordinates, and a scroll moves the
  // text out from under it. Scrolls inside the bubble itself do not leave the
  // shadow root, but the day one does it must not close what it scrolls.
  if (!tooltip.owns(event.target)) tooltip.hide();
}

export function startLauncher() {
  if (started) return;
  started = true;
  document.addEventListener("selectionchange", onSelectionChange);
  document.addEventListener("scroll", onScroll, { capture: true, passive: true });
  // Only where a finger can select, for the reason reading.js gives (D73):
  // on a mouse-only device the answer would never change, and the offer
  // stands above the phrase as it always has.
  if (navigator.maxTouchPoints > 0) {
    document.addEventListener("pointerdown", onPointerDown, { capture: true, passive: true });
  }
}

/**
 * Everything `startLauncher` put on the page, taken back - switching sites off
 * and switching the mode off both land here, and both have to leave the page
 * as if nothing had run.
 */
export function stopLauncher() {
  if (!started) return;
  started = false;
  document.removeEventListener("selectionchange", onSelectionChange);
  document.removeEventListener("scroll", onScroll, { capture: true });
  // Removing what was never added is a no-op, so no second capability check.
  document.removeEventListener("pointerdown", onPointerDown, { capture: true });
  if (timer !== null) {
    window.clearTimeout(timer);
    timer = null;
  }
  lastPointerType = "";
  shownText = "";
  tooltip.hide();
}
