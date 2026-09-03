export type ActivityActor = 'human' | 'agent' | 'terminal' | 'system';

export type ActivityEntry = {
	id: string;
	actor: ActivityActor;
	action: string;
	detail: string;
	path?: string;
	versionId?: string;
	sessionId?: string;
	createdAt: string;
};

const STORAGE_KEY = 'webmcp-desktop:activity-v1';
const MAX_ENTRIES = 120;

class ActivityService {
	#entries: ActivityEntry[] = [];
	#listeners = new Set<() => void>();
	#loaded = false;

	#load() {
		if (this.#loaded || typeof localStorage === 'undefined') return;
		this.#loaded = true;

		try {
			const data = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
			this.#entries = Array.isArray(data)
				? data
						.filter(
							(entry) =>
								entry &&
								typeof entry.id === 'string' &&
								typeof entry.action === 'string' &&
								typeof entry.detail === 'string' &&
								typeof entry.createdAt === 'string' &&
								['human', 'agent', 'terminal', 'system'].includes(entry.actor),
						)
						.slice(0, MAX_ENTRIES)
				: [];
		} catch {
			this.#entries = [];
		}
	}

	#persist() {
		if (typeof localStorage !== 'undefined') {
			try {
				localStorage.setItem(STORAGE_KEY, JSON.stringify(this.#entries));
			} catch {
				/* File saves must not fail because the lightweight activity feed is full. */
			}
		}
	}

	#notify() {
		for (const listener of this.#listeners) listener();
	}

	list(limit = 50) {
		this.#load();
		return this.#entries.slice(0, Math.max(0, limit));
	}

	record(entry: Omit<ActivityEntry, 'id' | 'createdAt'>) {
		this.#load();
		const next: ActivityEntry = {
			...entry,
			id: crypto.randomUUID(),
			createdAt: new Date().toISOString(),
		};

		this.#entries = [next, ...this.#entries].slice(0, MAX_ENTRIES);
		this.#persist();
		this.#notify();
		return next;
	}

	subscribe(listener: () => void) {
		this.#load();
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	clear() {
		this.#entries = [];
		this.#loaded = true;
		this.#persist();
		this.#notify();
	}
}

export const activityService = new ActivityService();
