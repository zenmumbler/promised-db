// promised-db - IndexedDB wrapped in a promise-based API with contextual methods and timeout support. (https://github.com/zenmumbler/promised-db)
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
	request: <T>(req: IDBRequest, fn?: (req: IDBRequest) => void) => Promise<T>;
	cursor: (container: IDBIndex | IDBObjectStore, range?: IDBKeyRange | IDBValidKey, direction?: PDBCursorDirection) => PDBCursor<IDBCursorWithValue>;
	keyCursor: (index: IDBIndex, range?: IDBKeyRange | IDBValidKey, direction?: PDBCursorDirection) => PDBCursor<IDBCursor>;
	timeout: (ms: number) => void;
}

export type PDBCursorDirection = "next" | "prev" | "nextunique" | "prevunique";

export interface PDBCursor<C extends IDBCursor> {
	next(callback: (cursor: C) => void): PDBCursor<C>;
	complete(callback: () => void): PDBCursor<C>;
	catch(callback: (error: any) => void): PDBCursor<C>;
}
interface PDBCursorBuilder<C extends IDBCursor> extends PDBCursor<C> {
	callbackFn_?: (cursor: C) => void;
	completeFn_?: () => void;
	errorFn_?: (error: any) => void;
}

export interface PromisedDB {
	transaction<T>(storeNames: string | string[], mode: PDBTransactionMode, fn: (tr: IDBTransaction, context: PDBTransactionContext) => Promise<T> | T): Promise<T>;
	close(): void;	
}

export function openDatabase(name: string, version: number, upgrade: PDBUpgradeCallback) {
	return new Promise<PromisedDB>(function(resolve, reject) {
		const req = indexedDB.open(name, version);
		req.onerror = () => { reject(req.error || `Could not open database "${name}"`); };
		req.onblocked = () => { reject("Database is outdated but cannot be upgraded because it is still being used elsewhere."); };
		req.onupgradeneeded = upgradeEvt => {
			const db = req.result;
			db.onerror = () => { reject("An error occurred while updating the database"); };
			upgrade(db, upgradeEvt.oldVersion, upgradeEvt.newVersion || version);
		};
		req.onsuccess = () => {
			const db = req.result;
			db.onerror = null;
			resolve(new PromisedDB(db));
		};
	});
}

export function openDatabaseWithMigrations(name: string, migrations: PDBMigrationCallback[]) {
	const version = migrations.length;
	if (version === 0) {
		return Promise.reject(new RangeError("At least one migration must be provided."));
	}

	return openDatabase(name, version,
		(db, migrationVersion) => {
			while (migrationVersion < version) {
				migrations[migrationVersion++](db);
			}
		});
}

export function deleteDatabase(name: string) {
	return new Promise<void>(function(resolve, reject) {
		const req = indexedDB.deleteDatabase(name);
		req.onerror = () => { reject(`Could not delete database "${name}"`); };
		req.onsuccess = () => { resolve(); };
	});
}

export function compareKeys(first: IDBValidKey, second: IDBValidKey) {
	return indexedDB.cmp(first, second);
}

export function listDatabases() {
	if (! indexedDB.databases) {
		return Promise.reject(new DOMException("The IDBFactory.databases method is not supported in this environment.", "NotSupportedError"));
	}
	return indexedDB.databases();
}

function request<R extends IDBRequest>(req: R, fn?: (req: R) => void): Promise<any> {
	return new Promise<any>((resolve, reject) => {
		req.onerror = () => { reject(req.error || "request failed"); };
		req.onsuccess = () => { resolve(req.result); };

		if (fn) {
			fn(req);
		}
	});
}

function cursorImpl<C extends IDBCursor>(cursorReq: IDBRequest): PDBCursor<C> {
	const result: PDBCursorBuilder<C> = {
		next: function(this: PDBCursorBuilder<C>, callback: (cursor: C) => void): PDBCursor<C> {
			this.callbackFn_ = callback;
			return this;
		},
		complete: function(this: PDBCursorBuilder<C>, callback: () => void): PDBCursor<C> {
			this.completeFn_ = callback;
			return this;
		},
		catch: function(this: PDBCursorBuilder<C>, callback: (error: any) => void): PDBCursor<C> {
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
	private db_: IDBDatabase;

	constructor(db: IDBDatabase) {
		this.db_ = db;
	}

	close() {
		this.db_.close();
	}

	transaction<T>(storeNames: string | string[], mode: PDBTransactionMode, fn: (tr: IDBTransaction, context: PDBTransactionContext) => Promise<T> | T): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			let timeoutID: number | undefined;
			const cancelTimeout = function() {
				if (timeoutID !== undefined) {
					clearTimeout(timeoutID);
					timeoutID = undefined;
				}
			};

			const tr = this.db_.transaction(storeNames, mode);
			tr.onerror = () => {
				cancelTimeout();
				reject(tr.error || "transaction failed");
			};
			tr.onabort = () => {
				cancelTimeout();
				reject("aborted");
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
						tr.abort();
					}, ms);
				}
			};

			const result = fn(tr, tc);
		});
	}
}
