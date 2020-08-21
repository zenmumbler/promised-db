// promised-db - IndexedDB wrapped in a promise-based API with contextual methods and timeout support.
// (c) 2016-Present by @zenmumbler

interface PDBDatabaseInfo {
	name: string;
	version: number;
}

interface IDBFactory {
	databases?(): Promise<PDBDatabaseInfo[]>;
}

declare module "promised-db" {
	type PDBTransactionMode = "readonly" | "readwrite";
	type PDBCursorDirection = "next" | "prev" | "nextunique" | "prevunique";

	interface PDBCursor<C extends IDBCursor> {
		next(callback: (cursor: C) => void): PDBCursor<C>;
		complete(callback: () => void): PDBCursor<C>;
		catch(callback: (error: any) => void): PDBCursor<C>;
	}

	interface PDBTransactionContext {
		request: <T>(req: IDBRequest, fn?: (req: IDBRequest) => void) => Promise<T>;
		cursor: (container: IDBIndex | IDBObjectStore, range?: IDBKeyRange | IDBValidKey, direction?: PDBCursorDirection) => PDBCursor<IDBCursorWithValue>;
		keyCursor: (index: IDBIndex, range?: IDBKeyRange | IDBValidKey, direction?: PDBCursorDirection) => PDBCursor<IDBCursor>;
		timeout: (ms: number) => void;
	}
	
	type PDBTransactionCallback<T> = (tr: IDBTransaction, context: PDBTransactionContext) => Promise<T> | T;
	type PDBUpgradeCallback = (db: IDBDatabase, tr: IDBTransaction, fromVersion: number, toVersion: number) => void;
	
	interface PromisedDB {
		transaction<T>(storeNames: string | string[], mode: PDBTransactionMode, fn: PDBTransactionCallback<T>): Promise<T>;
		close(): void;
	}

	function openDatabase(name: string, version: number, upgrade: PDBUpgradeCallback): Promise<PromisedDB>;
	function deleteDatabase(name: string): Promise<void>;
	function compareKeys(first: IDBValidKey, second: IDBValidKey): number;
	function listDatabases(): Promise<PDBDatabaseInfo[]>;
}
