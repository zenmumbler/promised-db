PromisedDB
==========
A library with TypeScript support for a better experience using IndexedDB, wrapping
the event handlers and clumsy cursor API while still being able to use IndexedDB as normal as possible.

You also get timeouts in transactions, a migration-based workflow and promise-based event signals
to coordinate database version conflicts.

Create or Open a Database
-------------------------
IndexedDB databases are separated by origin (domain name + port + protocol) and are
stored on the end-user's computer, they are referenced by name. Each database is
versioned, promised db takes advantage of this.

When you connect to a database, it opens up an existing database or creates a
new one if no database by that name exists. You will have to set up any stores
and indexes when creating a new db or upgrading an existing one. The easiest way
to do this is via a list of migrations.

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
import { PromisedDB } from "promised-db";

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
`outdated` promises on your pdb instance

```typescript
let waiting = false;
const pdb = await openDatabase(...);

// The first 2 promises are for the newer app that is trying to upgrade the database
pdb.blocked.then(() => {
  waiting = true;
  // Show some UI to ask the user to reload or close any other tabs running the same app.
});
pdb.opened.then(() => {
  if (waiting) {
    waiting = false;
    // Blocked status was resolved, continue normally.
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


Get notified when the database is closed externally
---------------------------------------------------
IndexedDB instances may be closed at any time if, for example, the user chooses
to clear out caches or if the alloted space for databases is running low. To be
notified when this happens you can listen for the `closed` promise to resolve
and take any action needed, like showing some UI to inform the user.

```typescript
const pdb = await openDatabase(...);
pdb.closed.then(() => {
  // oh no
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
call the `close` method on your instance:

```typescript
pdb.close(); // no result
```

While the pdb instance is still there after calling `close`(),
it is now in a state where you can no longer run transactions on it.

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
to `compareKeys`. This function is equivalent to `indexedDB.cmp()`.

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

⚠️ This feature is not yet widely implemented. `listDatabases` will reject with a
`DOMException` of type `NotSupportedError` if the feature is missing.

```typescript
import { listDatabases } from "promised-db";

// dbs is an array of { name: string; version: number; } records
const dbs = await listDatabases();
```

---

License: MIT License<br>
(c) 2016-Present by [@zenmumbler](https://twitter.com/zenmumbler)
