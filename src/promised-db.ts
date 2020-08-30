// promised-db - A promise-based wrapper to manage and simplify common tasks with IndexedDB
// https://github.com/zenmumbler/promised-db
// (c) 2016-Present by @zenmumbler

declare global {
	interface PDBDatabaseInfo {
		name: string;
		version: number;
	}

	interface IDBFactory {
		databases?(): Promise<PDBDatabaseInfo[]>;
	}
}

export type PDBTransactionCallback<T> = (tr: IDBTransaction, context: PDBTransactionContext) => Promise<T> | T;
export type PDBUpgradeCallback = (db: IDBDatabase, fromVersion: number, toVersion: number) => void;
export type PDBMigrationCallback = (db: IDBDatabase) => void;

export type PDBTransactionMode = "readonly" | "readwrite";
export interface PDBTransactionContext {
	/** Wrap a request inside a promise */
	request: <T>(req: IDBRequest) => Promise<T>;
	/** Return a cursor interface to iterate over a sequence of key-value pairs */
	cursor: (container: IDBIndex | IDBObjectStore, range?: IDBKeyRange | IDBValidKey, direction?: PDBCursorDirection) => PDBCursor<IDBCursorWithValue>;
	/** Return a cursor interface to iterate over a sequence of keys */
	keyCursor: (index: IDBIndex, range?: IDBKeyRange | IDBValidKey, direction?: PDBCursorDirection) => PDBCursor<IDBCursor>;
	/** Configure a timeout for this transaction. If the transaction does not complete within the specified time it will reject with a TimeoutError */
	timeout: (ms: number) => void;
}

export type PDBCursorDirection = "next" | "prev" | "nextunique" | "prevunique";

export interface PDBCursor<C extends IDBCursor> {
	/**
	 * Handler for each time the cursor moves to the next key or key-value pair.
	 * You must call `cursor.continue()` in this callback to continue iteration.
	 */
	next(callback: (cursor: C) => void): PDBCursor<C>;
	/** Optional callback for when the cursor has moved past the end of the range */
	complete(callback: () => void): PDBCursor<C>;
	/** Optional callback for when an error occurred while iterating over the range */
	catch(callback: (error: any) => void): PDBCursor<C>;
}
interface PDBCursorBuilder<C extends IDBCursor> extends PDBCursor<C> {
	callbackFn_?: (cursor: C) => void;
	completeFn_?: () => void;
	errorFn_?: (error: any) => void;
}

/**
 * Delete a named database. Main usage for this is if you are making way for
 * another process that is blocked waiting to upgrade the database.
 * @see blocked
 * @see outdated
 */
export function deleteDatabase(name: string) {
	return new Promise<void>(function(resolve, reject) {
		const req = indexedDB.deleteDatabase(name);
		req.onerror = () => { reject(req.error || new DOMException(`Could not delete database "${name}"`, "UnknownError")); };
		req.onsuccess = () => { resolve(); };
	});
}

/** Query the relative order of 2 keys. This function is equivalent to `indexedDB.cmp()`. */
export function compareKeys(first: IDBValidKey, second: IDBValidKey) {
	return indexedDB.cmp(first, second);
}

/**
 * Request a list of databases, getting the `name` and `version` of each.
 * This function is a promise-wrapped `indexedDB.databases()`.
 * NOTE: this feature is not yet widely supported and will throw if it is unavailable.
 */
export function listDatabases() {
	if (! indexedDB.databases) {
		return Promise.reject(new DOMException("The IDBFactory.databases method is not supported in this environment.", "NotSupportedError"));
	}
	return indexedDB.databases();
}

function request<R extends IDBRequest, T = any>(req: R): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		req.onerror = () => { reject(req.error || new DOMException("An error occurred while performing the request", "UnknownError")); };
		req.onsuccess = () => { resolve(req.result); };
	});
}

function cursorImpl<C extends IDBCursor>(cursorReq: IDBRequest): PDBCursor<C> {
	const result: PDBCursorBuilder<C> = {
		next(this: PDBCursorBuilder<C>, callback: (cursor: C) => void): PDBCursor<C> {
			this.callbackFn_ = callback;
			return this;
		},
		complete(this: PDBCursorBuilder<C>, callback: () => void): PDBCursor<C> {
			this.completeFn_ = callback;
			return this;
		},
		catch(this: PDBCursorBuilder<C>, callback: (error: any) => void): PDBCursor<C> {
			this.errorFn_ = callback;
			return this;
		}
	};

	cursorReq.onerror = function() {
		if (result.errorFn_) {
			result.errorFn_(cursorReq.error);
		}
	};
	cursorReq.onsuccess = function() {
		const cursor = cursorReq.result as C | undefined;
		if (cursor) {
			if (result.callbackFn_) {
				result.callbackFn_(cursor);
			}
		}
		else {
			if (result.completeFn_) {
				result.completeFn_();
			}
		}
	};

	return result;
}

function cursor(container: IDBIndex | IDBObjectStore, range?: IDBKeyRange | IDBValidKey, direction?: PDBCursorDirection) {
	const cursorReq = container.openCursor(range, direction);
	return cursorImpl<IDBCursorWithValue>(cursorReq);
}

function keyCursor(container: IDBIndex | IDBObjectStore, range?: IDBKeyRange | IDBValidKey, direction?: PDBCursorDirection) {
	const cursorReq = container.openKeyCursor(range, direction);
	return cursorImpl(cursorReq);
}


export class PromisedDB {
	/* @internal */
	private db_: Promise<IDBDatabase>;
	/* @internal */
	private closedPromise_!: Promise<void>;
	/* @internal */
	private versionChangePromise_!: Promise<void>;
	/* @internal */
	private blockedPromise_!: Promise<void>;

	/* @internal */
	constructor(name: string, migrations: PDBMigrationCallback[]);
	/* @internal */
	constructor(name: string, version: number, upgrade: PDBUpgradeCallback);
	constructor(name: string, vorm?: number | PDBMigrationCallback[], upgrade?: PDBUpgradeCallback) {

		let version: number;
		if (typeof vorm === "number" && typeof upgrade === "function") {
			version = vorm;
		}
		else {
			if (! Array.isArray(vorm)) {
				throw new TypeError("Incorrect parameter list, you must specify a name and either a version and upgrade callback or a list of migrations");
			}
			const migrations = vorm;
			version = migrations.length;
			upgrade = (db, migrationVersion) => {
				if (migrationVersion < 0 || migrationVersion >= version) {
					throw new DOMException("The current database version does not correspond to the provided migration list.", "VersionError");
				}
				while (migrationVersion < version) {
					migrations[migrationVersion++](db);
				}
			};
		}

		this.db_ = new Promise<IDBDatabase>((resolveDB, rejectDB) => {
		this.closedPromise_ = new Promise<void>((resolveClosed) => {
		this.versionChangePromise_ = new Promise<void>((resolveVersionChange) => {
		this.blockedPromise_ = new Promise<void>((resolveBlocked) => {
			const req = indexedDB.open(name, version);
			req.onerror = () => {
				rejectDB(req.error || new DOMException(`Could not open database "${name}"`, "UnknownError"));
			};
			req.onblocked = () => {
				resolveBlocked();
			};
			req.onupgradeneeded = (upgradeEvt) => {
				const db = req.result;
				db.onerror = (errorEvent) => {
					rejectDB((errorEvent as ErrorEvent).error ?? new DOMException("An error occurred while upgrading the database", "UnknownError"));
				};
				upgrade!(db, upgradeEvt.oldVersion, upgradeEvt.newVersion || version);
			};
			req.onsuccess = () => {
				const db = req.result;
				db.onerror = null;

				// Create the promises that will resolve on close and versionchange events.
				// These can be handled or ignored by users as they wish.
				// `versionchange` could technically be called multiple times but if it is
				// ignored the first time then it's not going to be handled anyway.
				db.onversionchange = () => {
					resolveVersionChange();
				};
				db.onclose = () => {
					resolveClosed();
				};

				resolveDB(db);
			};
		});
		});
		});
		});
	}

	/**
	 * Close the connection to the database.
	 * No further transactions can be performed after this point.
	 */
	close() {
		this.db_.then(
			db => db.close(),
			() => { /* ignore rejections */ }
		);
	}

	/**
	 * A promise that will resolve if the connection to the database opened and any
	 * upgrades were succesfully applied. In basic situations you don't have to wait for
	 * this to happen but waiting for this if the connection was blocked will allow
	 * you to remove any UI you put up while waiting for the connection to become available.
	 */
	get opened() {
		return this.db_.then(
			() => { /* return void promise */ },
			(_err) => { /* ignore rejections */ }
		);
	}

	/**
	 * A promise that will resolve if the connection to the database is closed externally.
	 * This promise will _not_ resolve if you close the connection yourself.
	 */
	get closed() {
		return this.closedPromise_;
	}

	/**
	 * A promise that will resolve if another process wants to upgrade the database.
	 * Typically, this means a newer version of your app has started in another window.
	 * In most cases, save any outstanding data and then close the connection to allow
	 * the
	 * @see blocked
	 */
	get outdated() {
		return this.versionChangePromise_;
	}

	/**
	 * A promise that will resolve if the attempt to open a connection to the database
	 * is blocked by another process that has an open connection to an earlier version
	 * of the database.
	 * @see outdated
	 */
	get blocked() {
		return this.blockedPromise_;
	}

	/**
	 * Perform a transaction on specific stores in the database and optionally return data.
	 * You may override the transaction's onerror handler but do not change the oncomplete or onabort events.
	 * @param storeNames One or more names of the stores to include this transaction
	 * @param mode Specify read only or read/write access to the stores
	 * @param fn Perform requests inside this function. Any value returned will be the value of the transaction's prmoise.
	 */
	transaction<T>(storeNames: string | string[], mode: PDBTransactionMode, fn: (tr: IDBTransaction, context: PDBTransactionContext) => Promise<T> | T): Promise<T> {
		return this.db_.then(db => new Promise<T>((resolve, reject) => {
			let timeoutID: number | undefined;
			let timedOut = false;
			const cancelTimeout = function() {
				if (timeoutID !== undefined) {
					clearTimeout(timeoutID);
					timeoutID = undefined;
				}
			};

			const tr = db.transaction(storeNames, mode);
			tr.onabort = () => {
				cancelTimeout();
				reject(timedOut ? new DOMException("The operation timed out", "TimeoutError") : tr.error);
			};
			tr.oncomplete = () => {
				cancelTimeout();
				resolve(result);
			};

			const tc: PDBTransactionContext = {
				request,
				cursor,
				keyCursor,
				timeout(ms: number) {
					timeoutID = setTimeout(function() {
						timeoutID = undefined;
						timedOut = true;
						tr.abort();
					}, ms);
				}
			};

			const result = fn(tr, tc);
		}));
	}
}
