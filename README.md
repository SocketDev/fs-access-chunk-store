# fs-access-chunk-store [![ci][ci-image]][ci-url] [![npm][npm-image]][npm-url] [![downloads][downloads-image]][downloads-url] [![javascript style guide][standard-image]][standard-url]

[ci-image]: https://img.shields.io/github/workflow/status/SocketDev/fs-access-chunk-store/ci/master
[ci-url]: https://github.com/SocketDev/fs-access-chunk-store/actions
[npm-image]: https://img.shields.io/npm/v/fs-access-chunk-store.svg
[npm-url]: https://npmjs.org/package/fs-access-chunk-store
[downloads-image]: https://img.shields.io/npm/dm/fs-access-chunk-store.svg
[downloads-url]: https://npmjs.org/package/fs-access-chunk-store
[standard-image]: https://img.shields.io/badge/code_style-standard-brightgreen.svg
[standard-url]: https://standardjs.com

#### [File System Access API](https://web.dev/file-system-access/) chunk store that is [abstract-chunk-store](https://github.com/mafintosh/abstract-chunk-store) compliant

[![abstract chunk store](https://cdn.rawgit.com/mafintosh/abstract-chunk-store/master/badge.svg)](https://github.com/mafintosh/abstract-chunk-store)

## Install

```
npm install fs-access-chunk-store
```

## Usage

```js
const fsAccessChunkStore = require('fs-access-chunk-store')
const chunks = fsAccessChunkStore(10)

chunks.put(0, new Buffer('01234567890'), function (err) {
  if (err) throw err
  chunks.get(0, function (err, chunk) {
    if (err) throw err
    console.log(chunk) // '01234567890' as a buffer
  })
})
```

## License

MIT. Copyright (c) [Socket Inc](https://socket.dev)
