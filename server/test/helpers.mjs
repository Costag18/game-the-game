// Tiny dependency-free test harness for the game engines.
// Provides a deterministic virtual clock (controls BOTH setTimeout AND Date.now)
// so timer-driven FSM games can be tested without real waits.

// ---- virtual clock -----------------------------------------------------------
let now = 1_000_000;
let timers = [];
let nextId = 1;

const realSetTimeout = global.setTimeout;
const realClearTimeout = global.clearTimeout;
const realDateNow = Date.now;

/** Reset virtual time + clear all pending timers (for per-test isolation). */
export function resetClock(start = 1_000_000) {
  now = start;
  timers = [];
  nextId = 1;
}

export function installClock(start = 1_000_000) {
  resetClock(start);
  Date.now = () => now;
  global.setTimeout = (fn, ms) => {
    const id = nextId++;
    timers.push({ id, at: now + (Number(ms) || 0), fn });
    return id;
  };
  global.clearTimeout = (id) => {
    const i = timers.findIndex((t) => t.id === id);
    if (i >= 0) timers.splice(i, 1);
  };
}

export function uninstallClock() {
  Date.now = realDateNow;
  global.setTimeout = realSetTimeout;
  global.clearTimeout = realClearTimeout;
}

/** Advance virtual time by `ms`, firing any timers whose deadline is reached, in order. */
export function advance(ms) {
  const target = now + ms;
  timers.sort((a, b) => a.at - b.at);
  while (timers.length && timers[0].at <= target) {
    const t = timers.shift();
    now = t.at;
    t.fn();
    timers.sort((a, b) => a.at - b.at);
  }
  now = target;
}

/** Fire only the single earliest pending timer (advancing the clock to its deadline). */
export function fireNext() {
  if (!timers.length) return false;
  timers.sort((a, b) => a.at - b.at);
  const t = timers.shift();
  now = t.at;
  t.fn();
  return true;
}

/** Set the virtual clock to an absolute value without firing timers (for precise ms). */
export function setNow(t) { now = t; }
export function getNow() { return now; }
export function pendingTimers() { return timers.length; }

// ---- assertions + runner -----------------------------------------------------
let passed = 0;
let failed = 0;
const failures = [];

export function test(name, fn) {
  try {
    resetClock(); // isolate each test's virtual clock + pending timers
    fn();
    passed++;
  } catch (e) {
    failed++;
    failures.push(`${name}: ${e.message}`);
  }
}

export function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

export function eq(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg || 'expected'} — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  }
}

export function report(label) {
  if (failures.length) {
    console.log(`\n${label}: ${passed} passed, ${failed} FAILED`);
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exitCode = 1;
  } else {
    console.log(`${label}: ${passed} passed, 0 failed`);
  }
  return failed === 0;
}
