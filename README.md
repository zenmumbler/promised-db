PromisedDB
==========

A library with TypeScript support for a better experience using IndexedDB, hiding
the event handlers and weird cursor API stuff that I don't like while still using
IndexedDB as normal as possible.

In return you get a simple class that wraps the transaction flow of IndexedDB with
(optional) Promise-wrapped actions performed on the IDB interfaces. It also adds
timeout functionality to transactions.

Create or Open a Database
-------------------------

```javascript
import PromisedDB from "promised-db";

const pdb = new PromisedDB("mydb", 1,
  (db, onDiskVersion, newVersion) => {
    // This callback is called when there is no DB on disk or if the version
    // number you specified is greater than the one on disk.
    // This function is the _only_ place where you can make schema changes to
    // the database.

    // db is just an IDBDatabase instance
    // proceed as in a normal upgradeneeded callback
    const stuff = db.createObjectStore("stuff", { keyPath: "index" });
    stuff.createIndex("userID", "userID", { unique: true });
  });
```

Transactions
------------

The `PromisedDB` instance you get back only has 1 method: `transaction`, every
operation on the db is done with a transaction, like so:

```javascript
// as with IDB, you specify the stores involved in this request
// and either "readonly" or "readwrite" as access type
const trans = pdb.transaction(["stuff", "morestuff"], "readonly",
  // you pass a function that constitutes the actual transaction
  // you get the IDBTransaction and a context object as parameters (see doc below)
  (tr, {request, getAll, getAllKeys, timeout, cursor, keyCursor}) => {
    // have this request timeout and abort after 5 seconds (optional)
    timeout(5000);

    // tr is a standard IDBTransaction interface
    const stuff = tr.objectStore("stuff");

    // use request(r: IDBRequest) to Promise-wrap any IDB request
    // this includes: get(), put(), update(), delete(), count(), etc.
    const itemProm = request(stuff.get(someKey));
    // itemProm is of type Promise<any>

    // getAll and getAllKeys are provided to either call native IDB 2
    // methods or a polyfill for implementations of IDB 1.
    const allRecords = getAll<RecordType>(someIndex or someStore, someKey);
    // allRecords is of type Promise<RecordType[]>

    // Use cursor or keyCursor to build a fluent cursor object to iterate
    // over rows with full control.
    // direction is "next" | "prev" | "nextunique" | "prevunique", default "next"
    cursor(stuff, optionalRange, direction)
      .next(cur => {
        // cur is an IDBCursor, `value` will be present for non-key cursors
        myProcessFunc(cur.value);
        // NOTE: you still MUST call cur.continue() to proceed to the next record
        cur.continue();
      })
      .complete(() => {
        // (optional) do something when the cursor has iterated to the end of the range
      })
      .catch(error => {
        // (optional) handle an error occuring inside cursor handling
      });

    // if you don't need to wait for the result you don't have to wrap requests
    stuff.delete(someOtherKey);

    // the optional return value of this function is the result type of
    // the transaction function's Promise.
    return Promise.all([itemProm, allRecords]);
  });

// Then just handle the transaction's Promise:
trans
  .then(result => {
    // ... process whatever you returned in your transaction function
  })
  .catch(error => {
    // ... handle any errors, including timeouts
  });
```

Interface
---------

```typescript
type PDBTransactionMode = "readonly" | "readwrite";
type PDBCursorDirection = "next" | "prev" | "nextunique" | "prevunique";

interface PDBCursorResult<C extends IDBCursor> {
  next(callback: (cursor: C) => void): PDBCursorResult<C>;
  complete(callback: () => void): PDBCursorResult<C>;
  catch(callback: (error: any) => void): PDBCursorResult<C>;
}

interface PDBTransactionContext {
  request: (req: IDBRequest, fn?: (req: IDBRequest) => void) => Promise<any>;
  cursor: (container: IDBIndex | IDBObjectStore, range?: IDBKeyRange | IDBValidKey, direction?: PDBCursorDirection) => PDBCursorResult<IDBCursorWithValue>;
  keyCursor: (index: IDBIndex, range?: IDBKeyRange | IDBValidKey, direction?: PDBCursorDirection) => PDBCursorResult<IDBCursor>;
  getAll: <T>(container: IDBIndex | IDBObjectStore, range?: IDBKeyRange | IDBValidKey, direction?: PDBCursorDirection, limit?: number) => Promise<T[]>;
  getAllKeys: <K extends IDBValidKey>(index: IDBIndex, range?: IDBKeyRange | IDBValidKey, direction?: PDBCursorDirection, limit?: number) => Promise<K[]>;
  timeout: (ms: number) => void;
}

type PDBUpgradeCallback = (db: IDBDatabase, fromVersion: number, toVersion: number) => void;
type PDBTransactionFunc = (tr: IDBTransaction, context: PDBTransactionContext) => Promise<T | void>;

class PromisedDB {
  constructor(name: string, version: number, upgrade: PDBUpgradeCallback);
  close(): void;
  transaction<T>(storeNames: string | string[], mode: PDBTransactionMode, fn: PDBTransactionFunc): Promise<T>;
}
```

---

License: MIT License<br>
(c) 2016-Present by Arthur Langereis ([@zenmumbler](https://twitter.com/zenmumbler))
