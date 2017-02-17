// promised-db - IndexedDB wrapped in a promise-based API with contextual methods and timeout support. (https://github.com/zenmumbler/promised-db)
// (c) 2016-Present by Arthur Langereis (@zenmumbler)

declare module "promised-db" {
	export type PDBTransactionMode = "readonly" | "readwrite";
	export type PDBCursorDirection = "next" | "prev" | "nextunique" | "prevunique";

	export interface PDBCursorResult<C extends IDBCursor> {
		next(callback: (cursor: C) => void): PDBCursorResult<C>;
		complete(callback: () => void): PDBCursorResult<C>;
		catch(callback: (error: any) => void): PDBCursorResult<C>;
	}

	export interface PDBTransactionContext {
		request: (req: IDBRequest, fn?: (req: IDBRequest) => void) => Promise<any>;
		cursor: (container: IDBIndex | IDBObjectStore, range?: IDBKeyRange | IDBValidKey, direction?: PDBCursorDirection) => PDBCursorResult<IDBCursorWithValue>;
		keyCursor: (index: IDBIndex, range?: IDBKeyRange | IDBValidKey, direction?: PDBCursorDirection) => PDBCursorResult<IDBCursor>;
		getAll: <T>(container: IDBIndex | IDBObjectStore, range?: IDBKeyRange | IDBValidKey, direction?: PDBCursorDirection, limit?: number) => Promise<T[]>;
		getAllKeys: <K extends IDBValidKey>(index: IDBIndex, range?: IDBKeyRange | IDBValidKey, direction?: PDBCursorDirection, limit?: number) => Promise<K[]>;
		timeout: (ms: number) => void;
	}

	type PDBUpgradeCallback = (db: IDBDatabase, fromVersion: number, toVersion: number) => void;
	type PDBTransactionFunc<T> = (tr: IDBTransaction, context: PDBTransactionContext) => Promise<T> | void;

	export class PromisedDB {
		constructor(name: string, version: number, upgrade: PDBUpgradeCallback);
		close(): void;
		transaction<T>(storeNames: string | string[], mode: PDBTransactionMode, fn: PDBTransactionFunc<T>): Promise<T | undefined>;
	}
}
