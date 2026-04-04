// Web Audio API sound engine — all sounds are synthesized, no asset files needed.
// Master volume is kept low (~15%) for subtle, non-intrusive audio.

let audioCtx = null;

function getCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  // Resume if suspended (browsers block autoplay until user gesture)
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function playTone(freq, duration, { type = 'sine', gain = 0.12, ramp = 0.02 } = {}) {
  const ctx = getCtx();
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0, ctx.currentTime);
  g.gain.linearRampToValueAtTime(gain, ctx.currentTime + ramp);
  g.gain.linearRampToValueAtTime(0, ctx.currentTime + duration);
  osc.connect(g).connect(ctx.destination);
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + duration + 0.05);
}

function playNoise(duration, { gain = 0.06, bandpass = null } = {}) {
  const ctx = getCtx();
  const bufferSize = ctx.sampleRate * duration;
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, ctx.currentTime);
  g.gain.linearRampToValueAtTime(0, ctx.currentTime + duration);
  if (bandpass) {
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = bandpass;
    filter.Q.value = 1;
    src.connect(filter).connect(g).connect(ctx.destination);
  } else {
    src.connect(g).connect(ctx.destination);
  }
  src.start();
  src.stop(ctx.currentTime + duration + 0.05);
}

// ─── Sound Definitions ──────────────────────────────────────

const sounds = {
  // UI
  click: () => playTone(800, 0.06, { type: 'square', gain: 0.06 }),
  menuOpen: () => playNoise(0.1, { gain: 0.04, bandpass: 2000 }),
  menuClose: () => playNoise(0.08, { gain: 0.03, bandpass: 1500 }),

  // Tournament flow
  roundStart: () => {
    playTone(523, 0.15, { gain: 0.1 });
    setTimeout(() => playTone(659, 0.15, { gain: 0.1 }), 120);
    setTimeout(() => playTone(784, 0.2, { gain: 0.12 }), 240);
  },
  voteCast: () => playTone(880, 0.1, { gain: 0.08 }),
  wagerLock: () => {
    playTone(1200, 0.08, { type: 'square', gain: 0.07 });
    setTimeout(() => playTone(1600, 0.12, { type: 'square', gain: 0.09 }), 80);
  },
  countdownTick: () => playTone(600, 0.05, { type: 'square', gain: 0.05 }),
  timerExpire: () => playTone(300, 0.3, { type: 'sawtooth', gain: 0.08 }),

  // Game events
  cardDeal: () => playNoise(0.07, { gain: 0.08, bandpass: 3000 }),
  cardFlip: () => playNoise(0.05, { gain: 0.06, bandpass: 4000 }),
  diceRoll: () => {
    for (let i = 0; i < 5; i++) {
      setTimeout(() => playNoise(0.04, { gain: 0.05, bandpass: 2500 }), i * 40);
    }
  },
  coinFlip: () => playTone(1400, 0.12, { type: 'triangle', gain: 0.1 }),
  wheelTick: () => playTone(1000, 0.03, { type: 'square', gain: 0.04 }),
  correct: () => {
    playTone(660, 0.1, { gain: 0.1 });
    setTimeout(() => playTone(880, 0.15, { gain: 0.12 }), 100);
  },
  wrong: () => {
    playTone(330, 0.15, { type: 'sawtooth', gain: 0.08 });
    setTimeout(() => playTone(260, 0.2, { type: 'sawtooth', gain: 0.06 }), 120);
  },
  yourTurn: () => {
    playTone(587, 0.12, { type: 'triangle', gain: 0.1 });
    setTimeout(() => playTone(784, 0.15, { type: 'triangle', gain: 0.12 }), 130);
  },

  // Social
  emoteSend: () => playTone(1200, 0.08, { type: 'sine', gain: 0.07 }),
  gifSend: () => playNoise(0.12, { gain: 0.05, bandpass: 3000 }),
  playerJoin: () => {
    playTone(523, 0.1, { type: 'triangle', gain: 0.08 });
    setTimeout(() => playTone(659, 0.12, { type: 'triangle', gain: 0.1 }), 100);
  },
  playerLeave: () => {
    playTone(440, 0.1, { type: 'triangle', gain: 0.07 });
    setTimeout(() => playTone(349, 0.15, { type: 'triangle', gain: 0.05 }), 100);
  },

  // Outcomes
  winRound: () => {
    playTone(523, 0.12, { gain: 0.12 });
    setTimeout(() => playTone(659, 0.12, { gain: 0.12 }), 120);
    setTimeout(() => playTone(784, 0.2, { gain: 0.14 }), 240);
  },
  loseRound: () => playTone(250, 0.3, { type: 'sine', gain: 0.06 }),
  casinoWin: () => {
    for (let i = 0; i < 6; i++) {
      setTimeout(() => playTone(1000 + i * 200, 0.06, { type: 'triangle', gain: 0.08 }), i * 50);
    }
  },
  casinoLoss: () => {
    playTone(400, 0.15, { gain: 0.06 });
    setTimeout(() => playTone(300, 0.2, { gain: 0.05 }), 130);
    setTimeout(() => playTone(220, 0.3, { gain: 0.04 }), 260);
  },
  tournamentWin: () => {
    const notes = [523, 659, 784, 1047, 1319];
    notes.forEach((freq, i) => {
      setTimeout(() => playTone(freq, 0.2, { gain: 0.14 }), i * 150);
    });
  },
  tournamentLoss: () => {
    playTone(392, 0.2, { type: 'triangle', gain: 0.07 });
    setTimeout(() => playTone(330, 0.25, { type: 'triangle', gain: 0.06 }), 180);
    setTimeout(() => playTone(262, 0.35, { type: 'triangle', gain: 0.05 }), 360);
  },

  // Pet
  petFeed: () => {
    playNoise(0.05, { gain: 0.04, bandpass: 1500 });
    setTimeout(() => playNoise(0.05, { gain: 0.04, bandpass: 1800 }), 80);
  },
  petStroke: () => playTone(250, 0.2, { type: 'sine', gain: 0.04 }),
  petBuy: () => {
    playTone(1200, 0.08, { type: 'square', gain: 0.07 });
    setTimeout(() => playTone(1500, 0.1, { type: 'square', gain: 0.09 }), 70);
  },
  coinCollect: () => playTone(1400, 0.06, { type: 'triangle', gain: 0.08 }),
};

export default sounds;
