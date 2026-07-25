import { logstr } from '../constants';
import { RefId } from '../utilities';

const criticalPointKey = 'QueueConsumerCriticalPoint';

// Bounded, fully-randomised block pacing. There are deliberately no user-facing
// timing settings: a fixed, tuneable interval is exactly the metronome pattern
// that reads as automation to x.com. Everything below is randomised within hard
// bounds so throughput stays plausible and can never produce silly values
// (no bursts of 100/sec, no gaps of a million seconds).
// ponytail: constants tuned by hand against x.com tolerances; adjust here if they change.
const PER_BLOCK_MIN_MS = 30_000; // floor gap between blocks within a burst (30s)
const PER_BLOCK_MAX_MS = 180_000; // ceiling gap between blocks within a burst (3m)
const BURST_MIN = 5; // blocks in a burst before a long rest
const BURST_MAX = 20;
const REST_MIN_MS = 5 * 60_000; // rest between bursts (5m)
const REST_MAX_MS = 30 * 60_000; // rest between bursts (30m)
const STARTUP_MIN_MS = 45_000; // delay before the first block of a session (45s)
const STARTUP_MAX_MS = 120_000; // delay before the first block of a session (2m)
const SESSION_CAP = 500; // hard outer ceiling of blocks per consumer session
const COOLDOWN_MIN_MS = 15 * 60_000; // back-off after x.com throttles us (15m)
const COOLDOWN_MAX_MS = 60 * 60_000; // back-off after x.com throttles us (60m)
const CP_BASE_MS = 1000; // base cadence for critical-point acquisition / polling

function randBetween(min: number, max: number): number {
	return min + Math.random() * (max - min);
}

function randInt(min: number, max: number): number {
	return Math.round(randBetween(min, max));
}

// this class provides to make sure there is only one consumer running per browser instance.
// this should hold true for multiple windows and multiple tabs all running the same code.
export class QueueConsumer {
	storage: typeof chrome.storage.local | typeof browser.storage.local;
	func: () => Promise<void>;
	canRun: () => boolean;
	private _timeout: number | null;
	private _interval: number;
	private _func_timeout: number | null;
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
		this._interval = CP_BASE_MS;
		this._func_timeout = null;
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
						time: new Date().valueOf() + this._interval * 1.5,
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
			return randBetween(STARTUP_MIN_MS, STARTUP_MAX_MS);
		}
		this._blocksUntilRest -= 1;
		if (this._blocksUntilRest <= 0) {
			// burst finished: take a long rest, then line up the next burst
			this._blocksUntilRest = randInt(BURST_MIN, BURST_MAX);
			return randBetween(REST_MIN_MS, REST_MAX_MS);
		}
		return randBetween(PER_BLOCK_MIN_MS, PER_BLOCK_MAX_MS);
	}
	async sync() {
		if (await this.getCriticalPoint()) {
			// paused (e.g. tab not focused): idle-check again shortly without consuming the queue
			if (!this.canRun()) {
				this._timeout = setTimeout(() => this.sync(), this._interval);
				return;
			}
			// we got and/or already had the critical point
			// if we just got it, func will be null and we can schedule it
			// if we already had it, it already finished or its waiting on queue
			if (this._func_timeout === null) {
				const delay = this.nextDelay();
				// renew our lease so another tab doesn't steal the critical point during a long wait
				await this.storage.set({
					[criticalPointKey]: {
						refId: this._refId,
						time: new Date().valueOf() + delay + CP_BASE_MS,
					},
				});
				this._func_timeout = setTimeout(
					() =>
						this.func()
							.then(() => {
								this._func_timeout = null;
								this._blocksThisSession += 1;
								if (this._blocksThisSession >= SESSION_CAP) {
									console.debug(
										logstr,
										'session block cap reached, pausing consumer',
									);
									return this.stop();
								}
								this.sync();
							})
							.catch(() => this.stop()),
					delay,
				);
			}
			this._timeout = null; // set timeout to null, just for the running check in start
		} else {
			// we couldn't get the critical point, so cancel func if its scheduled, then set timeout to check again
			if (this._func_timeout) {
				clearTimeout(this._func_timeout);
				this._func_timeout = null;
			}
			this._timeout = setTimeout(() => this.sync(), this._interval);
		}
	}
	// x.com pushed back (rate limit / refusal): pause for a long randomised period, then resume.
	// this is deliberately not stop() — we want blocking to come back on its own, just much later.
	cooldown() {
		if (this._func_timeout) {
			clearTimeout(this._func_timeout);
			this._func_timeout = null;
		}
		if (this._timeout) {
			clearTimeout(this._timeout);
			this._timeout = null;
		}
		this.releaseCriticalPoint();
		const wait = randBetween(COOLDOWN_MIN_MS, COOLDOWN_MAX_MS);
		console.debug(logstr, `queue consumer cooling down for ${Math.round(wait / 1000)}s`);
		this._timeout = setTimeout(() => {
			this._timeout = null;
			this.sync();
		}, wait);
	}
	start() {
		if (this._timeout || this._func_timeout) {
			// we're already running
			return;
		}
		console.debug(logstr, 'queue consumer started');
		this.sync();
	}
	stop() {
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
