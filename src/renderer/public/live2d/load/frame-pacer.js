/* CPU rendering uses a timer capped at 60 FPS; GPU rendering follows every display rAF. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.FireflyFramePacer = factory();
})(typeof window === "undefined" ? globalThis : window, function () {
  "use strict";
  return function createFramePacer(options) {
    const now = options.now || (() => performance.now());
    const raf = options.raf || ((fn) => requestAnimationFrame(fn));
    const cancelRaf = options.cancelRaf || ((id) => cancelAnimationFrame(id));
    const delay = options.delay || ((fn, ms) => setTimeout(fn, ms));
    const cancelDelay = options.cancelDelay || ((id) => clearTimeout(id));
    const clampFps = (v) => Math.min(60, Math.max(1, Number(v) || 60));
    let hardware = !!options.hardware;
    let fps = clampFps(options.fps);
    let active = false;
    let handle = null;
    let last = null;
    let nextDue = null;
    let scheduledHardware = false;

    function cancel() {
      if (handle !== null) (scheduledHardware ? cancelRaf : cancelDelay)(handle);
      handle = null;
    }

    function schedule() {
      if (!active || handle !== null) return;
      scheduledHardware = hardware;
      if (hardware) {
        // No software FPS gate here: every display callback is accepted, including 120/144 Hz.
        handle = raf(frame);
        return;
      }
      const current = now();
      const interval = 1000 / fps;
      if (nextDue === null) nextDue = current;
      else {
        nextDue += interval;
        // A slow CPU frame must not create a 4ms catch-up loop. Drop missed deadlines.
        if (nextDue <= current) nextDue = current + interval;
      }
      handle = delay(frame, Math.max(0, nextDue - current));
    }

    function frame() {
      handle = null;
      if (!active) return;
      const time = now();
      const dt = last === null ? 1000 / (hardware ? 60 : fps) : Math.min(100, Math.max(0, time - last));
      last = time;
      // Returning false freezes the last rendered image and cancels all future work.
      if (options.onFrame(dt, time) === false) {
        stop();
        return;
      }
      schedule();
    }

    function stop() {
      active = false;
      cancel();
      last = null;
      nextDue = null;
    }

    return {
      start() {
        if (active) return;
        active = true;
        last = null;
        nextDue = null;
        schedule();
      },
      stop,
      setMode(nextHardware, nextFps) {
        const next = clampFps(nextFps);
        if (hardware === !!nextHardware && fps === next) return;
        cancel();
        hardware = !!nextHardware;
        fps = next;
        last = null;
        nextDue = null;
        schedule();
      },
      get running() { return active; },
    };
  };
});
