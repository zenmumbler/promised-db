declare global {
    interface IDBDatabaseInfo {
        name: string;
        version: number;
    }
    interface IDBFactory {
        /** New in IndexedDB 3.0 - not widely implemented */
        databases(): Promise<IDBDatabaseInfo[]>;
    }
    type IDBTransactionDurability = "default" | "strict" | "relaxed";
    interface IDBTransactionOptions {
        durability?: IDBTransactionDurability;
    }
    interface IDBDatabase {
        transaction(storeNames: string | string[], mode?: IDBTransactionMode, options?: IDBTransactionOptions): IDBTransaction;
    }
    interface IDBTransaction {
        /** New in IndexedDB 3.0 - not widely implemented */
        commit(): void;
        /** New in IndexedDB 3.0 - not widely implemented */
        readonly durability: IDBTransactionDurability;
    }
    interface IDBCursor {
        /** New in IndexedDB 3.0 - not widely implemented */
        readonly request: IDBRequest;
    }
}
export declare type PDBUpgradeHandler = (db: IDBDatabase, fromVersion: number) => void;
export declare type PDBMigrationHandler = (db: IDBDatabase) => void;
export declare type PDBTransactionHandler<T> = (tx: IDBTransaction, helpers: PDBTransactionHelpers) => Promise<T> | T;
export interface PDBCursorOptions {
    range?: IDBKeyRange | IDBValidKey;
    direction?: IDBCursorDirection;
}
export interface PDBTransactionHelpers {
    /** Wrap a request inside a promise */
    request: <T>(req: IDBRequest) => Promise<T>;
    /** Return a cursor interface to iterate over a sequence of key-value pairs */
    cursor: (container: IDBIndex | IDBObjectStore, options?: PDBCursorOptions) => PDBCursor<IDBCursorWithValue>;
    /** Return a cursor interface to iterate over a sequence of keys */
    keyCursor: (container: IDBIndex | IDBObjectStore, options?: PDBCursorOptions) => PDBCursor<IDBCursor>;
    /** Configure a timeout for this transaction. If the transaction does not complete within the specified time it will reject with a TimeoutError */
    timeout: (ms: number) => void;
}
export interface PDBCursor<C extends IDBCursor> {
    /**
     * Handler for each time the cursor moves to the next key or key-value pair.
     * You must call `cursor.continue()` in this callback to continue iteration.
     */
    next(callback: (cursor: C) => void): PDBCursor<C>;
    /** Optional callback for when the cursor has moved past the end of the range */
    complete(callback: () => void): PDBCursor<C>;
    /** Optional callback for when an error occurred while iterating over the range */
    catch(callback: (error: DOMException, event: ErrorEvent) => void): PDBCursor<C>;
}
/**
 * Delete a named database. This will fail if the database in question is still
 * in use or if it doesn't exist.
 */
export declare function deleteDatabase(name: string): Promise<void>;
/** Query the relative order of 2 keys. This function is equivalent to `indexedDB.cmp()`. */
export declare function compareKeys(first: IDBValidKey, second: IDBValidKey): number;
/**
 * Request a list of databases, getting the `name` and `version` of each.
 * This function is a promise-wrapped `indexedDB.databases()`.
 * NOTE: this feature is not yet widely supported and will throw if it is unavailable.
 */
export declare function listDatabases(): Promise<IDBDatabaseInfo[]>;
/** A promise-based wrapper to manage and simplify common tasks with IndexedDB */
export declare class PromisedDB {
    /** Open a named database providing a list of migration functions */
    constructor(name: string, migrations: PDBMigrationHandler[]);
    /** Open a named database with manual version and upgrade management */
    constructor(name: string, version: number, upgrade: PDBUpgradeHandler);
    /**
     * Close the connection to the database.
     * No further transactions can be performed after this point.
     */
    close(): void;
    /**
     * A promise that will resolve if the connection to the database opened and any
     * upgrades were succesfully applied. In basic situations you don't have to wait for
     * this to happen but waiting for this if the connection was blocked will allow
     * you to remove any UI you put up while waiting for the connection to become available.
     */
    get opened(): Promise<void>;
    /**
     * A promise that will resolve if the connection to the database is closed externally.
     * This promise will _not_ resolve if you close the connection yourself.
     */
    get closed(): Promise<void>;
    /**
     * A promise that will resolve if another process wants to upgrade the database.
     * Typically, this means a newer version of your app has started in another window.
     * In most cases, save any outstanding data and then close the connection to allow
     * the
     * @see blocked
     */
    get outdated(): Promise<void>;
    /**
     * A promise that will resolve if the attempt to open a connection to the database
     * is blocked by another process that has an open connection to an earlier version
     * of the database.
     * @see outdated
     */
    get blocked(): Promise<void>;
    /**
     * Perform a transaction on specific stores in the database and optionally return data.
     * You may override the transaction's onerror handler but do not change the oncomplete or onabort events.
     * @param storeNames One or more names of the stores to include this transaction
     * @param mode Specify read only or read/write access to the stores
     * @param handler Perform requests inside this function. Any value returned will be the value of the transaction's prmoise.
     */
    transaction<T>(storeNames: string | string[], mode: PDBTransactionMode, handler: PDBTransactionHandler<T>): Promise<T>;
}
