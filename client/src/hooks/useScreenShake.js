const DURATIONS = { light: 250, medium: 350, heavy: 400 };

let shakeTimer = null;

export function useScreenShake() {
  return function shake(intensity = 'medium') {
    const el = document.documentElement;
    const cls = `screen-shake-${intensity}`;
    // Clear any ongoing shake
    if (shakeTimer) {
      clearTimeout(shakeTimer);
      el.classList.remove('screen-shake-light', 'screen-shake-medium', 'screen-shake-heavy');
    }
    // Force reflow so re-triggering the same class restarts the animation
    void el.offsetWidth;
    el.classList.add(cls);
    shakeTimer = setTimeout(() => {
      el.classList.remove(cls);
      shakeTimer = null;
    }, DURATIONS[intensity] || 350);
  };
}
