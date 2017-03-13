// promised-db - IndexedDB wrapped in a promise-based API with contextual methods and timeout support. (https://github.com/zenmumbler/promised-db)
// (c) 2016-Present by Arthur Langereis (@zenmumbler)
var PromisedDB = (function () {
    function PromisedDB(name, version, upgrade) {
        this.db_ = this._request(indexedDB.open(name, version), function (openReq) {
            openReq.onupgradeneeded = function (upgradeEvt) {
                var db = openReq.result;
                upgrade(db, upgradeEvt.oldVersion, upgradeEvt.newVersion || version);
            };
        })
            .catch(function (error) {
            console.warn("PromisedDB: failed to open / upgrade database '" + name + "'", error);
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
    PromisedDB.prototype.close = function () {
        this.db_.then(function (db) {
            db.close();
        });
    };
    PromisedDB.prototype.transaction = function (storeNames, mode, fn) {
        var _this = this;
        return this.db_.then(function (db) {
            return new Promise(function (resolve, reject) {
                var tr = db.transaction(storeNames, mode);
                tr.onerror = function () {
                    cancelTimeout();
                    reject(tr.error || "transaction failed");
                };
                tr.onabort = function () {
                    cancelTimeout();
                    reject("aborted");
                };
                var timeoutID = null;
                var cancelTimeout = function () {
                    if (timeoutID !== null) {
                        clearTimeout(timeoutID); // make timeouts work for both web and node contexts
                        timeoutID = null;
                    }
                };
                var tc = Object.create(_this.tctx_, {
                    timeout: {
                        value: function (ms) {
                            timeoutID = setTimeout(function () {
                                timeoutID = null;
                                tr.abort();
                            }, ms);
                        }
                    }
                });
                var result = fn(tr, tc);
                tr.oncomplete = function () {
                    cancelTimeout();
                    resolve(result);
                };
            });
        });
    };
    PromisedDB.prototype._request = function (req, fn) {
        var reqProm = new Promise(function (resolve, reject) {
            req.onerror = function () { reject(req.error || "request failed"); };
            req.onsuccess = function () { resolve(req.result); };
            if (fn) {
                fn(req);
            }
        });
        return this.db_ ? this.db_.then(function () { return reqProm; }) : reqProm;
    };
    PromisedDB.prototype._cursorImpl = function (cursorReq) {
        var result = {
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
            var cursor = cursorReq.result;
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
    };
    PromisedDB.prototype._cursor = function (container, range, direction) {
        var cursorReq = container.openCursor(range, direction);
        return this._cursorImpl(cursorReq);
    };
    // IDB 2 has IDBObjectStore.openKeyCursor, but 1 does not
    PromisedDB.prototype._keyCursor = function (index, range, direction) {
        var cursorReq = index.openKeyCursor(range, direction);
        return this._cursorImpl(cursorReq);
    };
    PromisedDB.prototype._getAll = function (container, range, direction, limit) {
        var _this = this;
        return new Promise(function (resolve, reject) {
            var result = [];
            _this._cursor(container, range, direction)
                .next(function (cur) {
                result.push(cur.value);
                if (limit && (result.length === limit)) {
                    resolve(result);
                }
                else {
                    cur.continue();
                }
            })
                .complete(function () {
                resolve(result);
            })
                .catch(function (error) {
                reject(error);
            });
        });
    };
    PromisedDB.prototype._getAllKeys = function (container, range, direction, limit) {
        var _this = this;
        return new Promise(function (resolve, reject) {
            var result = [];
            _this._keyCursor(container, range, direction)
                .next(function (cur) {
                result.push(cur.primaryKey);
                if (limit && (result.length === limit)) {
                    resolve(result);
                }
                else {
                    cur.continue();
                }
            })
                .complete(function () {
                resolve(result);
            })
                .catch(function (error) {
                reject(error);
            });
        });
    };
    return PromisedDB;
}());
export default PromisedDB;
//# sourceMappingURL=promised-db.js.map