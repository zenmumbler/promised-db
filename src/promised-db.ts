// promised-db - IndexedDB wrapped in a promise-based API with contextual methods and timeout support. (https://github.com/zenmumbler/promised-db)
// (c) 2016-Present by Arthur Langereis (@zenmumbler)

export type PDBUpgradeCallback = (db: IDBDatabase, fromVersion: number, toVersion: number) => void;

export type PDBTransactionMode = "readonly" | "readwrite";
export type PDBTransactionRequestFn = (req: IDBRequest, fn?: (req: IDBRequest) => void) => Promise<any>;
export interface PDBTransactionContextBase {
	readonly request: PDBTransactionRequestFn;
	readonly cursor: (container: IDBIndex | IDBObjectStore, range?: IDBKeyRange | IDBValidKey, direction?: PDBCursorDirection) => PDBCursorResult<IDBCursorWithValue>;
	readonly keyCursor: (index: IDBIndex, range?: IDBKeyRange | IDBValidKey, direction?: PDBCursorDirection) => PDBCursorResult<IDBCursor>;
	readonly getAll: <T>(container: IDBIndex | IDBObjectStore, range?: IDBKeyRange | IDBValidKey, direction?: PDBCursorDirection, limit?: number) => Promise<T[]>;
	readonly getAllKeys: <K extends IDBValidKey>(index: IDBIndex, range?: IDBKeyRange | IDBValidKey, direction?: PDBCursorDirection, limit?: number) => Promise<K[]>;
}
export interface PDBTransactionContext extends PDBTransactionContextBase {
	readonly timeout: (ms: number) => void;
}

export type PDBCursorDirection = "next" | "prev" | "nextunique" | "prevunique";

export interface PDBCursorResult<C extends IDBCursor> {
	next(callback: (cursor: C) => void): PDBCursorResult<C>;
	complete(callback: () => void): PDBCursorResult<C>;
	catch(callback: (error: any) => void): PDBCursorResult<C>;
}
interface PDBCursorBuilder<C extends IDBCursor> extends PDBCursorResult<C> {
	callbackFn_?: (cursor: C) => void;
	completeFn_?: () => void;
	errorFn_?: (error: any) => void;
}


export class PromisedDB {
	private db_: Promise<IDBDatabase>;
	private tctx_: PDBTransactionContextBase;

	constructor(name: string, version: number, upgrade: PDBUpgradeCallback) {
		this.db_ = this._request(indexedDB.open(name, version),
			openReq => {
				openReq.onupgradeneeded = upgradeEvt => {
					const db = openReq.result as IDBDatabase;
					upgrade(db, upgradeEvt.oldVersion, upgradeEvt.newVersion || version);
				};
			})
			.catch(error => {
				console.warn(`PromisedDB: failed to open / upgrade database '${name}'`, error);
			});

		// the TransactionContext is implemented as the private methods in PDB
		// bound to this and exposed as loose functions.
		this.tctx_ = {
			request: this._request.bind(this),
			cursor: this._cursor.bind(this),
			keyCursor: this._keyCursor.bind(this),
			getAll: this._getAll.bind(this),
			getAllKeys: this._getAllKeys.bind(this)
		};
	}

	close() {
		this.db_.then(db => {
			db.close();
		});
	}

	transaction<T>(storeNames: string | string[], mode: PDBTransactionMode, fn: (tr: IDBTransaction, context: PDBTransactionContext) => Promise<T | void>) {
		return this.db_.then(db => {
			return new Promise<T>((resolve, reject) => {
				const tr = db.transaction(storeNames, mode);
				tr.onerror = () => {
					cancelTimeout();
					reject(tr.error || "transaction failed");
				};
				tr.onabort = () => {
					cancelTimeout();
					reject("aborted");
				};

				let timeoutID: number | NodeJS.Timer | null = null;
				const cancelTimeout = function() {
					if (timeoutID !== null) {
						clearTimeout(<any>timeoutID); // make timeouts work for both web and node contexts
						timeoutID = null;
					}
				};

				const tc: PDBTransactionContext = Object.create(this.tctx_, {
					timeout: {
						value: function(ms: number) {
							console.info(`transaction will time out in ${ms}ms`);
							timeoutID = setTimeout(function() {
								console.warn(`transaction timed out after ${ms}ms`);
								timeoutID = null;
								tr.abort();
							}, ms);
						}
					}
				});

				const result = fn(tr, tc);
				tr.oncomplete = () => {
					cancelTimeout();
					resolve((result === undefined) ? undefined : result);
				};
			});
		});
	}

	private _request<R extends IDBRequest>(req: R, fn?: (req: R) => void): Promise<any> {
		const reqProm = new Promise<any>(function(resolve, reject) {
				req.onerror = () => { reject(req.error || "request failed"); };
				req.onsuccess = () => { resolve(req.result); };

				if (fn) {
					fn(req);
				}
			});

		return this.db_ ? this.db_.then(() => reqProm) : reqProm;
	}

	private _cursorImpl<C extends IDBCursor>(cursorReq: IDBRequest): PDBCursorResult<C> {
		const result: PDBCursorBuilder<C> = {
			next: function(this: PDBCursorBuilder<C>, callback: (cursor: C) => void): PDBCursorResult<C> {
				this.callbackFn_ = callback;
				return this;
			},
			complete: function(this: PDBCursorBuilder<C>, callback: () => void): PDBCursorResult<C> {
				this.completeFn_ = callback;
				return this;
			},
			catch: function(this: PDBCursorBuilder<C>, callback: (error: any) => void): PDBCursorResult<C> {
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

	private _cursor(container: IDBIndex | IDBObjectStore, range?: IDBKeyRange | IDBValidKey, direction?: PDBCursorDirection) {
		const cursorReq = container.openCursor(range, direction);
		return this._cursorImpl<IDBCursorWithValue>(cursorReq);
	}

	// IDB 2 has IDBObjectStore.openKeyCursor, but 1 does not
	private _keyCursor(index: IDBIndex, range?: IDBKeyRange | IDBValidKey, direction?: PDBCursorDirection) {
		const cursorReq = index.openKeyCursor(range, direction);
		return this._cursorImpl(cursorReq);
	}

	private _getAll<T>(container: IDBIndex | IDBObjectStore, range?: IDBKeyRange | IDBValidKey, direction?: PDBCursorDirection, limit?: number) {
		return new Promise<T[]>((resolve, reject) => {
			const result: T[] = [];

			this._cursor(container, range, direction)
				.next(cur => {
					result.push(cur.value as T);
					if (limit && (result.length === limit)) {
						resolve(result);
					}
					else {
						cur.continue();
					}
				})
				.complete(() => {
					resolve(result);
				})
				.catch(error => {
					reject(error);
				});
		});
	}

	private _getAllKeys<K extends IDBValidKey>(container: IDBIndex, range?: IDBKeyRange | IDBValidKey, direction?: PDBCursorDirection, limit?: number) {
		return new Promise<K[]>((resolve, reject) => {
			const result: K[] = [];

			this._keyCursor(container, range, direction)
				.next(cur => {
					result.push(cur.primaryKey);
					if (limit && (result.length === limit)) {
						resolve(result);
					}
					else {
						cur.continue();
					}
				})
				.complete(() => {
					resolve(result);
				})
				.catch(error => {
					reject(error);
				});
		});
	}
}
