PromisedDB
==========
A library with TypeScript support for a better experience using IndexedDB, wrapping
the event handlers and clumsy cursor API while still being able to use IndexedDB as normal as possible.

You also get timeouts in transactions, a migration-based workflow and promise-based event signals
to coordinate database version conflicts.

Create or open a database
-------------------------
IndexedDB databases are separated by origin (domain name + port + protocol) and are
stored on the end-user's computer, they are referenced by name. Each database is
versioned, promised db takes advantage of this.

Creating a PromisedDB instance opens up an existing database or creates a
new one if no database by that name exists. When a new database is created or if
your code introduces changes to the database schema, the database needs to be upgraded.
The easiest way to do this is via a list of migrations:

```typescript
import { PromisedDB } from "promised-db";

const migrations = [
  (db: IDBDatabase) => {
    // first migration, create initial stores and indexes (version 0 -> 1)
    const users = db.createObjectStore("myUsers", { keyPath: "userID" });
    users.createIndex("userEmail", "email", { unique: true });
  },
  (db: IDBDatabase) => {
    // second migration, first update (version 1 -> 2)
    const users = db.objectStore("myUsers");
    users.name = "users";
  }
  // etc
];

const pdb = new PromisedDB("mydb", migrations);
```

Each function runs one migration similar to how they are managed in many server
frameworks. The number of migrations equals the current version of the database.
PromisedDB will automatically call the correct migrations for new and existing
databases.

### Manual Versioning

If you need to have more fine-grained control over versions and the upgrade process
you can also specify a version number and a single upgrade function:

```typescript
const pdb = new PromisedDB("mydb", 1,
  (db, onDiskVersion, newVersion) => {
    if (onDiskVersion < 1) {
      const stuff = db.createObjectStore("stuff", { keyPath: "index" });
      stuff.createIndex("userID", "userID", { unique: true });
    }
    // ...etc
  });
```

Handling version conflicts
--------------------------
IndexedDB is typically used in web apps that may stay open in a tab for long
periods of time, sometimes days or even longer. If a user opens a new tab with your
app then your new code may have changed to use a newer revision of the database.

Both the app trying to upgrade and any apps running with older versions will be
notified of this situation and you can attach handlers to the `blocked` and
`outdated` promises on your pdb instance:

```typescript
let waiting = false;
const pdb = new PromisedDB(...);

// The first 2 promises are for the newer app that is trying to upgrade the database
pdb.blocked.then(() => {
  waiting = true;
  // Show some UI to ask the user to reload or close any other tabs running the same app.
});
pdb.opened.then(() => {
  if (waiting) {
    waiting = false;
    // Blocked status was resolved, continue as usual.
  }
});

// This promise will resolve on apps running older code to notify them that they
// are blocking the newer code from proceeding.
pdb.outdated.then(() => {
  // Recommended course of action is to save any outstanding data
  // and then close the connection or to reload the current window if
  // that would not put the app in a state that would surprise the user.
  saveData();
  pdb.close();
  showReloadUI();
});
```

Handling this situation is optional. If you do not act on `blocked` or `outdated` signals
the newer code will not connect and the older code will continue blissfully unaware.

Transactions
------------
Every read/write operation on the db is done in a transaction, start one using the
`transaction` method:

```typescript
// as with IDB, you specify the stores involved in this request
// and either "readonly" or "readwrite" as access type
const trans = pdb.transaction(["stuff", "morestuff"], "readonly",
  // you pass a function that constitutes the actual transaction
  // you get the IDBTransaction and a helpers object as parameters (see doc below)
  (tx, {request, timeout, cursor, keyCursor}) => {
    // have this request timeout and abort after 5 seconds (optional)
    timeout(5000);

    // tx is a standard IDBTransaction interface
    const stuff = tx.objectStore("stuff");

    // use request(r: IDBRequest) to Promise-wrap any IDB request
    // this includes: get(), put(), update(), delete(), count(), getAll(), getAllKeys(), etc.
    // provide the type of the result to get a typed promise
    const itemProm = request<MyItem>(stuff.get(someKey));

    // Use cursor or keyCursor to build a fluent cursor object to iterate
    // over either all rows or those within a `range`, if provided.
    // `direction` is "next" | "prev" | "nextunique" | "prevunique", default "next"
    cursor(stuff, { range, direction })
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
      .catch((error: DOMException, event: ErrorEvent) => {
        // (optional) handle an error occurring inside cursor handling
        // you can call `event.preventDefault()` to have failures not cause
        // the whole transaction to abort
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

`transaction` also takes an optional 3rd argument to specify the durability
of the transaction. This can be done to ensure quick flushing of critical data.

⚠️ This feature is not yet widely implemented. In environments where it is not
available, this option is ignored and "relaxed" durability (the default) is used.

```typescript
const trans = pdb.transaction(["stuff", "morestuff"], "readonly",
  {
    durability: "strict"
  },
  (tx, {request}) => {
    // ...
  });
```


Closing the Database
--------------------
Normally you don't need to close a database explicitly, the main use case for
this is in response to an `outdated` signal. Closing the connection allows
upgrade events in other instances of your app to continue.

```typescript
pdb.close();
```

Get notified when the database is closed externally
---------------------------------------------------
IndexedDB instances may be closed at any time if, for example, the user chooses
to clear out caches or if the allotted space for databases is running low. To be
notified when this happens you can listen for the `closed` promise to resolve
and take any action needed, like showing some UI to inform the user.

Note that this promise does not resolve if you close the database yourself. This
is purely a notification for when the database is closed outside of your control.

```typescript
const pdb = new PromisedDB(...);
pdb.closed.then(() => {
  // oh no
});
```

List available databases
------------------------
You can request a list of databases, getting the `name` and `version` of each.
This function is a promise-wrapped `indexedDB.databases()`.

⚠️ This feature is not yet widely implemented. `listDatabases` will reject with a
`DOMException` of type `NotSupportedError` if the feature is missing.

```typescript
import { listDatabases } from "promised-db";

// dbs is an array of { name: string; version: number; } records
const dbs = await listDatabases();
```

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

Deleting will fail if the named database doesn't exist or is still in use.

Testing the relative order of keys
----------------------------------
You can manually query the relative order of 2 keys by passing them to
`compareKeys`. This function is equivalent to `indexedDB.cmp()` and mainly
provided for consistency.

```typescript
import { compareKeys } from "promised-db";

// ordering is -1 if keyA < keyB, 1 if keyA > keyB and 0 if the keys are equal
let ordering = compareKeys(keyA, keyB);
```

This function will throw if either keyA or keyB is not a valid IndexedDB key.

---

License: MIT License<br>
(c) 2016-Present by [@zenmumbler](https://twitter.com/zenmumbler)
