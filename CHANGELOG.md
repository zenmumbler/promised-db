# promised-db changelog

## 3.0.0 - 2020-08-30
- BREAKING: removed openDatabase call again
- BREAKING: removed useless function argument for request
- BREAKING: place the 2 optional args to cursor helpers in an options object
- BREAKING: removed 2nd argument to upgrade function, which is redundant
- expose all IDB 3.0 new type additions and normalise existing type usage
- add optional `options` argument to transaction for IDB 3 transaction options
- add support for simple managed migrations
- add signal promises for opened, closed, outdated and blocked
- add errorevent param to cursor error handler
- add doc comments to all APIs for in-editor help

## 2.0.0 - 2020-08-21
- basically, most things have changed and expanded, read the README for details
- BREAKING: now distributed as a single ES6 module with named exports
- BREAKING: instance creation is now done through a helper method (openDatabase)
- BREAKING: all() and allKeys() methods removed (use built-in ones instead)
- added deleteDatabase, compareKeys and listDatabases helper methods

## 1.0.4 - 2017-03-13
- added this change log
- (BREAKING) the PromisedDB export is now a default export
- module file now has ES5 syntax

## 1.0.3 - 2017-03-13
- add module file with ES2015 style exports
- es5 export uses AMD instead of UMD

## 1.0.2 - 2017-02-19
- Initial public release
- IDB 1 level API support only
