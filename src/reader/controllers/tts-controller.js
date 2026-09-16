/**
 * Reader TTS Controller.
 * Manages Web Speech API synthesis, speech playback queues, sentence-level
 * and word-level karaoke highlighting timing, and autoscroll coordinates.
 */

export class TtsController {
  /**
   * @param {Object} [options]
   * @param {Function|null} [options.onSentenceChange]
   * @param {Function|null} [options.onWordHighlight]
   * @param {Function|null} [options.onStateChange]
   */
  constructor({ onSentenceChange = null, onWordHighlight = null, onStateChange = null } = {}) {
    /** @type {Function|null} */
    this.onSentenceChange = onSentenceChange;
    /** @type {Function|null} */
    this.onWordHighlight = onWordHighlight;
    /** @type {Function|null} */
    this.onStateChange = onStateChange;

    /** @type {SpeechSynthesis | null} */
    this.synth = typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : null;
    /** @type {SpeechSynthesisUtterance | null} */
    this.activeUtterance = null;
    this.isPlaying = false;
    this.rate = 1.0;
    this.currentSentenceIndex = -1;
    /** @type {string[]} */
    this.sentences = [];
  }

  /**
   * Loads sentences to speak.
   * @param {string[]} sentences
   * @param {number} [startIndex=0]
   */
  load(sentences, startIndex = 0) {
    this.stop();
    this.sentences = Array.isArray(sentences) ? sentences : [];
    this.currentSentenceIndex = Math.max(0, Math.min(startIndex, this.sentences.length - 1));
  }

  /**
   * Plays the current sentence or resumes playback.
   */
  play() {
    if (!this.synth || this.sentences.length === 0) return;
    if (this.currentSentenceIndex < 0 || this.currentSentenceIndex >= this.sentences.length) {
      this.currentSentenceIndex = 0;
    }

    const text = this.sentences[this.currentSentenceIndex];
    if (!text) return;

    this.synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = this.rate;

    utterance.onboundary = (event) => {
      if (typeof this.onWordHighlight === "function") {
        this.onWordHighlight({
          charIndex: event.charIndex,
          charLength: event.charLength ?? 0,
          sentenceIndex: this.currentSentenceIndex,
        });
      }
    };

    utterance.onend = () => {
      if (this.currentSentenceIndex + 1 < this.sentences.length) {
        this.currentSentenceIndex += 1;
        this.play();
      } else {
        this.stop();
      }
    };

    utterance.onerror = () => {
      this.stop();
    };

    this.activeUtterance = utterance;
    this.isPlaying = true;
    this.synth.speak(utterance);

    if (typeof this.onSentenceChange === "function") {
      this.onSentenceChange(this.currentSentenceIndex, text);
    }
    if (typeof this.onStateChange === "function") {
      this.onStateChange({ isPlaying: true, index: this.currentSentenceIndex });
    }
  }

  /**
   * Pauses TTS playback.
   */
  pause() {
    if (this.synth && this.isPlaying) {
      this.synth.pause();
      this.isPlaying = false;
      if (typeof this.onStateChange === "function") {
        this.onStateChange({ isPlaying: false, index: this.currentSentenceIndex });
      }
    }
  }

  /**
   * Stops TTS playback and resets position.
   */
  stop() {
    if (this.synth) {
      this.synth.cancel();
    }
    this.activeUtterance = null;
    this.isPlaying = false;
    if (typeof this.onStateChange === "function") {
      this.onStateChange({ isPlaying: false, index: this.currentSentenceIndex });
    }
  }

  /**
   * Steps forward or backward by sentence count.
   * @param {number} delta
   */
  step(delta) {
    const nextIndex = this.currentSentenceIndex + delta;
    if (nextIndex >= 0 && nextIndex < this.sentences.length) {
      this.currentSentenceIndex = nextIndex;
      if (this.isPlaying) {
        this.play();
      } else if (typeof this.onSentenceChange === "function") {
        this.onSentenceChange(this.currentSentenceIndex, this.sentences[this.currentSentenceIndex]);
      }
    }
  }

  /**
   * Sets the playback rate multiplier.
   * @param {number} rate
   */
  setRate(rate) {
    this.rate = Math.max(0.5, Math.min(rate, 2.5));
    if (this.isPlaying) {
      this.play();
    }
  }
}
