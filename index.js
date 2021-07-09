const queueMicrotask = require('queue-microtask')

class WebFsChunkStore {
  constructor (chunkLength, opts = {}) {
    this.chunkLength = Number(chunkLength)

    if (!this.chunkLength) {
      throw new Error('First argument must be a chunk length')
    }

    this.closed = false
    this.length = Number(opts.length) || Infinity

    if (this.length !== Infinity) {
      this.lastChunkLength = this.length % this.chunkLength || this.chunkLength
      this.lastChunkIndex = Math.ceil(this.length / this.chunkLength) - 1
    }

    this.name = opts.name || 'default'

    this.rootDirPromise = opts.rootDir || navigator.storage.getDirectory()
    this.storageDirPromise = this._getStorageDirectoryHandle()

    this.chunks = []
  }

  async _getStorageDirectoryHandle () {
    const rootDir = await this.rootDirPromise
    return await rootDir.getDirectoryHandle(this.name, { create: true })
  }

  async _getChunk (index) {
    let chunk = this.chunks[index]

    if (!chunk) {
      const fileName = index.toString()
      const storageDir = await this.storageDirPromise

      chunk = this.chunks[index] = {
        fileHandlePromise: storageDir.getFileHandle(fileName, { create: true })
      }
    }

    return chunk
  }

  put (index, buf, cb = () => {}) {
    if (this.closed) {
      queueMicrotask(() => cb(new Error('Storage is closed')))
      return
    }

    const isLastChunk = index === this.lastChunkIndex
    if (isLastChunk && buf.length !== this.lastChunkLength) {
      queueMicrotask(() => {
        cb(new Error(`Last chunk length must be ${this.lastChunkLength}`))
      })
      return
    }
    if (!isLastChunk && buf.length !== this.chunkLength) {
      queueMicrotask(() => {
        cb(new Error(`Chunk length must be ${this.chunkLength}`))
      })
      return
    }

    ;(async () => {
      try {
        const chunk = await this._getChunk(index)
        const fileHandle = await chunk.fileHandlePromise
        const stream = await fileHandle.createWritable({
          keepExistingData: false
        })
        await stream.write(buf)
        await stream.close()
      } catch (err) {
        cb(err)
        return
      }

      cb(null)
    })()
  }

  get (index, opts, cb = () => {}) {
    if (typeof opts === 'function') {
      return this.get(index, null, opts)
    }
    if (this.closed) {
      queueMicrotask(() => cb(new Error('Storage is closed')))
      return
    }

    const isLastChunk = index === this.lastChunkIndex
    const chunkLength = isLastChunk ? this.lastChunkLength : this.chunkLength

    if (!opts) opts = {}

    const offset = opts.offset || 0
    const len = opts.length || chunkLength - offset

    ;(async () => {
      let buf
      try {
        const chunk = await this._getChunk(index)
        const fileHandle = await chunk.fileHandlePromise
        let file = await fileHandle.getFile()
        if (offset !== 0 || len !== chunkLength) {
          file = file.slice(offset, len + offset)
        }
        buf = await file.arrayBuffer()
      } catch (err) {
        cb(err)
        return
      }

      if (buf.byteLength === 0) {
        const err = new Error(`Index ${index} does not exist`)
        err.notFound = true
        cb(err)
        return
      }

      cb(null, Buffer.from(buf))
    })()
  }

  close (cb = () => {}) {
    if (this.closed) {
      queueMicrotask(() => cb(new Error('Storage is closed')))
      return
    }

    this.closed = true
    this.chunks = []

    queueMicrotask(() => {
      cb(null)
    })
  }

  destroy (cb = () => {}) {
    if (this.closed) {
      queueMicrotask(() => cb(new Error('Storage is closed')))
      return
    }

    const handleClose = async err => {
      if (err) {
        cb(err)
        return
      }

      try {
        const rootDir = await this.rootDirPromise
        await rootDir.removeEntry(this.name, { recursive: true })
      } catch (err) {
        cb(err)
        return
      }
      cb(null)
    }

    this.close(handleClose)
  }
}

module.exports = WebFsChunkStore
