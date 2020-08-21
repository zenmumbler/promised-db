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
The `openDatabase` function returns a promise to a `PromisedDB` instance and works
similarly to a `new IndexedDB(...)` call. You provide the db name and version and the
upgrade function. The returned promise resolves when any upgrades are complete.

```typescript
import { openDatabase } from "promised-db";

const pdb = await openDatabase("mydb", 1,
  (db, tr, onDiskVersion, newVersion) => {
    // This callback is called when there is no DB on disk or if the version
    // number you specified is greater than the one on disk.
    // This function is the _only_ place where you can make schema changes to
    // the database.

    // tr is the internal transaction for the upgrade, with which you can
    // for example get the currently present stores
    const activeStores = tr.objectStoreNames;

    // db is an IDBDatabase instance
    // proceed as in a normal upgradeneeded callback
    const stuff = db.createObjectStore("stuff", { keyPath: "index" });
    stuff.createIndex("userID", "userID", { unique: true });
  });
```

Transactions
------------
Every read/write operation on the db is done in a transaction, start one using the
`transaction` method:

```typescript
// as with IDB, you specify the stores involved in this request
// and either "readonly" or "readwrite" as access type
const trans = pdb.transaction(["stuff", "morestuff"], "readonly",
  // you pass a function that constitutes the actual transaction
  // you get the IDBTransaction and a context object as parameters (see doc below)
  (tr, {request, timeout, cursor, keyCursor}) => {
    // have this request timeout and abort after 5 seconds (optional)
    timeout(5000);

    // tr is a standard IDBTransaction interface
    const stuff = tr.objectStore("stuff");

    // use request(r: IDBRequest) to Promise-wrap any IDB request
    // this includes: get(), put(), update(), delete(), count(), getAll(), getAllKeys(), etc.
    // provide the type of the result to get a typed promise
    const itemProm = request<MyItem>(stuff.get(someKey));

    // Use cursor or keyCursor to build a fluent cursor object to iterate
    // over rows with full control.
    // direction is "next" | "prev" | "nextunique" | "prevunique", default "next"
    cursor(stuff, optionalRange, direction)
      .next(cur => {
        // cur is an IDBCursor, `value` will be present for non-key cursors
        myProcessFunc(cur.value);
        // NOTE: you still have to call cur.continue() to proceed to the next record
        // or use calls like cur.continuePrimaryKey(...) for paged views etc.
        cur.continue();
      })
      .complete(() => {
        // (optional) do something when the cursor has iterated to the end of the range
      })
      .catch(error => {
        // (optional) handle an error occurring inside cursor handling
      });

    // if you don't care about the result you don't have to wrap requests
    stuff.delete(someOtherKey);

    // the optional return value of this function is the result type of
    // the transaction function's Promise.
    return Promise.all([itemProm, allRecords]);
  });

// Then handle the transaction's Promise:
trans
  .then(result => {
    // ... process whatever you returned in your transaction function
  })
  .catch(error => {
    // ... handle any errors, including timeouts
  });
```

Closing the Database
--------------------
In many cases you don't have to manually close a database, but if you do then
call the `close` method on your instance

```typescript
pdb.close(); // no result
```

Keep in mind that while you will still have an active instance, it is now
in a state where you can no longer run transactions on it.

Deleting a Database
-------------------
To delete a database, pass the name of the database you wish to delete.
This function is a promise-wrapped `indexedDB.deleteDatabase()`.

```typescript
import { deleteDatabase } from "promised-db";

deleteDatabase("mydb")
  .then(() => { /* success */ })
  .catch(err => { /* handle error */ });
```

Deleting will fail if the database does't exist or is still in use.

Testing the relative order of keys
----------------------------------
You can manually query the relative order of 2 keys by passing them
to `compareKeys`. This function is a promise-wrapped `indexedDB.cmp()`.

```typescript
import { compareKeys } from "promised-db";

// ordering is -1 if keyA < keyB, 1 if keyA > keyB and 0 if the keys are equal
let ordering = compareKeys(keyA, keyB);
```

This function will throw if either keyA or keyB is not a valid IndexedDB key.

List available databases
------------------------
You can request a list of databases, getting the `name` and `version` of each.
This function is a promise-wrapped `indexedDB.databases()`.

⚠️ This feature is not yet widely implemented. `listDatabases` will return a
`DOMException` of type `NotSupportedError` when the feature is missing.

```typescript
import { listDatabases } from "promised-db";

// dbs is an array of { name: string; version: number; } records
const dbs = await listDatabases();
```

---

License: MIT License<br>
(c) 2016-Present by [@zenmumbler](https://twitter.com/zenmumbler)
