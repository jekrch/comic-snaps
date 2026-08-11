/**
 * A fixed-hop tap on the captured audio — the piece of infrastructure every
 * remaining tempo problem in `AudioReactor` traces back to.
 *
 * ## What it fixes
 *
 * The reactor reads its spectrum from an `AnalyserNode` once per *drawn* frame, so
 * its analysis hop is the frame time: 16.7ms on an idle desktop, 33ms behind the
 * mobile cap, 40–50ms on a loaded post chain, and varying between all three from
 * one frame to the next. Every measurement in §18 of
 * `docs/visualizer-audio-attribution.md` that degrades with frame rate degrades
 * because of that, and three separate failures share the cause:
 *
 * - tempo error rising from 0.2% to 3.8% between 60fps and 12fps, because a 35ms
 *   hi-hat inside an 83ms hop is invisible;
 * - off-grid material taking a *confident* lock below 15fps, most likely because
 *   the surviving onsets alias onto the frame grid, which is itself periodic;
 * - the one bench pattern that reads half-time, whose sixteenths at 172BPM are
 *   87ms against a 100ms refractory and arrive as a smeared mess.
 *
 * A worklet is pulled by the audio thread, not the renderer, so it sees every
 * 128-sample block whatever the GPU is doing. It accumulates them into hops of a
 * fixed size and posts each one out. Nothing here analyses anything: it exists so
 * that whatever does the analysing gets an even, complete, frame-rate-independent
 * stream.
 *
 * ## Why the source is a string
 *
 * `audioWorklet.addModule` takes a URL, and the module is evaluated in a scope with
 * no bundler, no imports and no `fetch`. Shipping it as a separate entry point means
 * teaching Vite to emit it as its own chunk and then finding it at runtime in dev
 * and in the built site. A blob URL is self-contained, works identically in both,
 * and the processor is small enough that inlining it costs nothing. The trade is
 * that this text is not type-checked — so it is kept to the minimum that cannot be
 * done anywhere else.
 */

/**
 * Samples per posted hop. 512 at 48kHz is 10.7ms, which is the hop the tempo
 * literature is written around and four times finer than a 60fps frame.
 */
export const TAP_HOP = 512;

/**
 * The FFT length the consumer analyses each hop against. Twice the hop, for the
 * usual 50% overlap.
 */
export const TAP_BUFFER = 1024;

export const TAP_PROCESSOR = `
class AudioTap extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.hop = options.processorOptions.hop;
    this.buffer = new Float32Array(this.hop);
    this.filled = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (input && input.length > 0) {
      const channels = input.length;
      const frames = input[0].length;
      for (let i = 0; i < frames; i++) {
        // Mixed to mono here rather than downstream: every consumer of this wants
        // one channel, and a stereo mix whose sides differ is not two pieces of
        // rhythmic evidence.
        let sum = 0;
        for (let c = 0; c < channels; c++) sum += input[c][i];
        this.buffer[this.filled++] = sum / channels;
        if (this.filled === this.hop) {
          // Transferred rather than copied, so a hop costs no allocation on the
          // receiving side and no structured clone on this one.
          this.port.postMessage(this.buffer, [this.buffer.buffer]);
          this.buffer = new Float32Array(this.hop);
          this.filled = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('audio-tap', AudioTap);
`;

/** The processor name, which has to agree between the source above and the node. */
export const TAP_NAME = "audio-tap";
