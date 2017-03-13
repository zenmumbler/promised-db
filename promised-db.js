// promised-db - IndexedDB wrapped in a promise-based API with contextual methods and timeout support. (https://github.com/zenmumbler/promised-db)
// (c) 2016-Present by Arthur Langereis (@zenmumbler)
export class PromisedDB {
    constructor(name, version, upgrade) {
        this.db_ = this._request(indexedDB.open(name, version), openReq => {
            openReq.onupgradeneeded = upgradeEvt => {
                const db = openReq.result;
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
    transaction(storeNames, mode, fn) {
        return this.db_.then(db => {
            return new Promise((resolve, reject) => {
                const tr = db.transaction(storeNames, mode);
                tr.onerror = () => {
                    cancelTimeout();
                    reject(tr.error || "transaction failed");
                };
                tr.onabort = () => {
                    cancelTimeout();
                    reject("aborted");
                };
                let timeoutID = null;
                const cancelTimeout = function () {
                    if (timeoutID !== null) {
                        clearTimeout(timeoutID); // make timeouts work for both web and node contexts
                        timeoutID = null;
                    }
                };
                const tc = Object.create(this.tctx_, {
                    timeout: {
                        value: function (ms) {
                            timeoutID = setTimeout(function () {
                                timeoutID = null;
                                tr.abort();
                            }, ms);
                        }
                    }
                });
                const result = fn(tr, tc);
                tr.oncomplete = () => {
                    cancelTimeout();
                    resolve(result);
                };
            });
        });
    }
    _request(req, fn) {
        const reqProm = new Promise(function (resolve, reject) {
            req.onerror = () => { reject(req.error || "request failed"); };
            req.onsuccess = () => { resolve(req.result); };
            if (fn) {
                fn(req);
            }
        });
        return this.db_ ? this.db_.then(() => reqProm) : reqProm;
    }
    _cursorImpl(cursorReq) {
        const result = {
            next: function (callback) {
                this.callbackFn_ = callback;
                return this;
            },
            complete: function (callback) {
                this.completeFn_ = callback;
                return this;
            },
            catch: function (callback) {
                this.errorFn_ = callback;
                return this;
            }
        };
        cursorReq.onerror = function () {
            if (result.errorFn_) {
                result.errorFn_(cursorReq.error);
            }
        };
        cursorReq.onsuccess = function () {
            const cursor = cursorReq.result;
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
    _cursor(container, range, direction) {
        const cursorReq = container.openCursor(range, direction);
        return this._cursorImpl(cursorReq);
    }
    // IDB 2 has IDBObjectStore.openKeyCursor, but 1 does not
    _keyCursor(index, range, direction) {
        const cursorReq = index.openKeyCursor(range, direction);
        return this._cursorImpl(cursorReq);
    }
    _getAll(container, range, direction, limit) {
        return new Promise((resolve, reject) => {
            const result = [];
            this._cursor(container, range, direction)
                .next(cur => {
                result.push(cur.value);
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
    _getAllKeys(container, range, direction, limit) {
        return new Promise((resolve, reject) => {
            const result = [];
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
//# sourceMappingURL=promised-db.js.map