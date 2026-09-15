import { logstr } from '../constants';
import { RefId } from '../utilities';

const criticalPointKey = 'QueueConsumerCriticalPoint';

// Bounded, fully-randomised block pacing. There are deliberately no user-facing
// timing settings: a fixed, tuneable interval is exactly the metronome pattern
// that reads as automation to x.com. Every wait below is drawn log-uniformly
// between hard bounds: most gaps land near the geometric middle with a long tail
// of much longer pauses, and nothing bunches at either edge — the shape of a
// person drifting in and out of a feed, not a timer. Bounds are hard, so it can
// never produce silly values (no bursts of 100/sec, no gaps of a million seconds).
// ponytail: constants tuned by hand against x.com tolerances; adjust here if they change.
const PER_BLOCK_MIN_MS = 45_000; // floor gap between blocks within a burst (45s)
const PER_BLOCK_MAX_MS = 8 * 60_000; // ceiling gap between blocks within a burst (8m)
const BURST_MIN = 3; // blocks in a burst before a long rest
const BURST_MAX = 12;
const REST_MIN_MS = 12 * 60_000; // rest between bursts (12m)
const REST_MAX_MS = 90 * 60_000; // rest between bursts (90m)
const STARTUP_MIN_MS = 60_000; // delay before the first block of a session (1m)
const STARTUP_MAX_MS = 5 * 60_000; // delay before the first block of a session (5m)
const COOLDOWN_MIN_MS = 30 * 60_000; // back-off after x.com throttles us (30m)
const COOLDOWN_MAX_MS = 120 * 60_000; // back-off after x.com throttles us (2h)
const SESSION_CAP = 300; // blocks before an enforced long pause
const CAP_PAUSE_MIN_MS = 2 * 3_600_000; // pause after hitting the cap (2h)
const CAP_PAUSE_MAX_MS = 6 * 3_600_000; // pause after hitting the cap (6h)
const CP_BASE_MS = 1000; // base cadence for critical-point acquisition / polling

// log-uniform draw: uniform in log-space, so the median is the geometric mean of
// the bounds and long waits are common without ever piling up at the limits.
function randLog(min: number, max: number): number {
	return min * Math.pow(max / min, Math.random());
}

function randInt(min: number, max: number): number {
	return Math.floor(min + Math.random() * (max - min + 1));
}

// this class provides to make sure there is only one consumer running per browser instance.
// this should hold true for multiple windows and multiple tabs all running the same code.
// within a tab there is exactly one chain of wait -> block -> wait: start() is a no-op while
// running, and every step re-checks _running so a stop()/cooldown() mid-await ends the chain.
// (the previous version re-entered sync() from concurrent start() calls, spawning parallel
// chains that multiplied the block rate and defeated the pacing entirely.)
export class QueueConsumer {
	storage: typeof chrome.storage.local | typeof browser.storage.local;
	func: () => Promise<void>;
	canRun: () => boolean;
	private _timeout: number | null; // idle poll while running, or the cooldown timer while stopped
	private _func_timeout: number | null; // the one pending block
	private _running: boolean;
	private _refId: number;
	private _started: boolean;
	private _blocksUntilRest: number;
	private _blocksThisSession: number;
	/**
		storage: the storage type used to sync tabs. likely chrome.storage.local
		func: async function used to consume from the queue. reject stops consumer, resolve queues next run
		canRun: optional gate checked before each block; when it returns false the consumer idles
			without consuming the queue (used to pause while the tab is not focused)
	*/
	constructor(
		storage: typeof chrome.storage.local | typeof browser.storage.local,
		func: () => Promise<any>,
		canRun: () => boolean = () => true,
	) {
		this.storage = storage;
		this.func = func;
		this.canRun = canRun;
		this._timeout = null;
		this._func_timeout = null;
		this._running = false;
		this._refId = RefId(); // consumer is assigned to a tab, so keep it in the class
		this._started = false;
		this._blocksUntilRest = randInt(BURST_MIN, BURST_MAX);
		this._blocksThisSession = 0;
	}
	async getCriticalPoint(): Promise<boolean> {
		let cpRefId = null;
		do {
			const cp = (await this.storage.get({ [criticalPointKey]: null }))[criticalPointKey];
			// cp === null: the critical point is up for grabs
			// cp.refId === this.refId: we have the critical point, so we should update the checkin time
			// cp.refId !== this.refId: we do not have the critical point
			// 	cp.refId !== this.refId && cp.time > now: another tab is running the consumer and is active
			// 	cp.refId !== this.refId && cp.time <= now: another tab is running the consumer and is inactive
			if (!cp || cp.refId === this._refId || cp.time <= new Date().valueOf()) {
				// try to access the critical point
				await this.storage.set({
					[criticalPointKey]: {
						refId: this._refId,
						time: new Date().valueOf() + CP_BASE_MS * 1.5,
					},
				});
				await new Promise(r => setTimeout(r, 10)); // wait a second to make sure any other sets have resolved
				cpRefId = (await this.storage.get({ [criticalPointKey]: null }))[criticalPointKey]
					?.refId;
			} else {
				return false;
			}
		} while (cpRefId !== this._refId);
		return true;
	}
	async releaseCriticalPoint() {
		const cp = (await this.storage.get({ [criticalPointKey]: null }))[criticalPointKey];
		if (cp?.refId === this._refId && cp.time > new Date().valueOf()) {
			// critical point belongs to us, so we can safely release it
			await this.storage.set({ [criticalPointKey]: null });
		}
	}
	// how long to wait before the next block, following a bounded burst-and-rest shape
	nextDelay(): number {
		if (!this._started) {
			// don't fire the instant the tab loads; wait a randomised startup delay
			this._started = true;
			return randLog(STARTUP_MIN_MS, STARTUP_MAX_MS);
		}
		this._blocksUntilRest -= 1;
		if (this._blocksUntilRest <= 0) {
			// burst finished: take a long rest, then line up the next burst
			this._blocksUntilRest = randInt(BURST_MIN, BURST_MAX);
			return randLog(REST_MIN_MS, REST_MAX_MS);
		}
		return randLog(PER_BLOCK_MIN_MS, PER_BLOCK_MAX_MS);
	}
	async sync() {
		if (!this._running) return;
		const acquired = await this.getCriticalPoint();
		if (!this._running) return; // stopped while we were waiting on storage
		if (!acquired || !this.canRun()) {
			// another tab owns the consumer, or this tab isn't in the foreground: check back shortly
			this._timeout = setTimeout(() => {
				this._timeout = null;
				this.sync();
			}, CP_BASE_MS);
			return;
		}
		const delay = this.nextDelay();
		console.debug(logstr, `next block in ${Math.round(delay / 1000)}s`);
		// renew our lease so another tab doesn't steal the critical point during a long wait
		await this.storage.set({
			[criticalPointKey]: {
				refId: this._refId,
				time: new Date().valueOf() + delay + CP_BASE_MS,
			},
		});
		if (!this._running) return;
		this._func_timeout = setTimeout(() => {
			this._func_timeout = null;
			if (!this.canRun()) {
				// tab went to the background during the wait: don't block, idle until it's back
				this.sync();
				return;
			}
			this.func()
				.then(() => {
					this._blocksThisSession += 1;
					if (this._blocksThisSession >= SESSION_CAP) {
						this._blocksThisSession = 0;
						console.debug(logstr, 'session block cap reached, pausing consumer');
						return this.cooldown(CAP_PAUSE_MIN_MS, CAP_PAUSE_MAX_MS);
					}
					return this.sync();
				})
				.catch(() => this.stop()); // func rejects when the queue is empty
		}, delay);
	}
	// x.com pushed back (rate limit / refusal), or we hit the session cap: stop for a long
	// randomised period, then come back on our own. deliberately not a plain stop().
	cooldown(min: number = COOLDOWN_MIN_MS, max: number = COOLDOWN_MAX_MS) {
		this.stop();
		const wait = randLog(min, max);
		console.debug(logstr, `queue consumer cooling down for ${Math.round(wait / 60_000)}m`);
		this._timeout = setTimeout(() => {
			this._timeout = null;
			this.start();
		}, wait);
	}
	start() {
		if (this._running || this._timeout) {
			// already running, or cooling down
			return;
		}
		this._running = true;
		console.debug(logstr, 'queue consumer started');
		this.sync();
	}
	stop() {
		this._running = false;
		if (this._timeout) {
			clearTimeout(this._timeout);
			this._timeout = null;
		}
		if (this._func_timeout) {
			clearTimeout(this._func_timeout);
			this._func_timeout = null;
		}
		this.releaseCriticalPoint();
		console.debug(logstr, 'queue consumer stopped');
	}
}
