export class Timer {
  constructor(durationSeconds, onTick, onExpire) {
    this.duration = durationSeconds;
    this.remaining = durationSeconds;
    this.onTick = onTick;
    this.onExpire = onExpire;
    this.intervalId = null;
  }

  start() {
    this.remaining = this.duration;
    this.intervalId = setInterval(() => {
      this.remaining--;
      if (this.remaining <= 0) {
        this.stop();
        this.onExpire();
      } else {
        this.onTick(this.remaining);
      }
    }, 1000);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  getRemainingSeconds() {
    return this.remaining;
  }
}
