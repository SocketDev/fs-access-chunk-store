/* eslint-env browser */
class WebFsChunkStore {
  constructor (chunkLength, opts = {}) {
    this.chunkLength = Number(chunkLength)

    if (!this.chunkLength) {
      throw new Error('First argument must be a chunk length')
    }

    this.closed = false

    this.name = opts.name || 'default'

    this.rootDirPromise = opts.rootDir || navigator.storage.getDirectory()
    this.storageDirPromise = this._getStorageDirectoryHandle()
    this.chunksDirPromise = ((opts.files && opts.rootDir) && this._getChunksDirHandle()) || this.storageDirPromise

    this.chunks = [] // individual chunks, required for reads :/
    this.chunkMap = [] // full files
    this.directoryMap = {}

    if (opts.files && opts.rootDir) {
      this.files = opts.files.slice(0).map((file, i, files) => {
        if (file.path == null) throw new Error('File is missing `path` property')
        if (file.length == null) throw new Error('File is missing `length` property')
        if (file.offset == null) {
          if (i === 0) {
            file.offset = 0
          } else {
            const prevFile = files[i - 1]
            file.offset = prevFile.offset + prevFile.length
          }
        }

        // file handles
        if (file.handle == null) {
          file.handle = this._createFileHandle({ path: file.path })
        }

        // file chunkMap
        const fileStart = file.offset
        const fileEnd = file.offset + file.length

        const firstChunk = Math.floor(fileStart / this.chunkLength)
        const lastChunk = Math.floor((fileEnd - 1) / this.chunkLength)

        for (let p = firstChunk; p <= lastChunk; ++p) {
          const chunkStart = p * this.chunkLength
          const chunkEnd = chunkStart + this.chunkLength

          const from = (fileStart < chunkStart) ? 0 : fileStart - chunkStart
          const to = (fileEnd > chunkEnd) ? this.chunkLength : fileEnd - chunkStart
          const offset = (fileStart > chunkStart) ? 0 : chunkStart - fileStart

          if (!this.chunkMap[p]) this.chunkMap[p] = []

          this.chunkMap[p].push({ from, to, offset, file })
        }

        return file
      })

      // close streams is page is frozen/unloaded, they will re-open if the user returns via BFC
      window.addEventListener('pagehide', this.cleanup)

      this.length = this.files.reduce((sum, file) => sum + file.length, 0)
      if (opts.length != null && opts.length !== this.length) {
        throw new Error('total `files` length is not equal to explicit `length` option')
      }
    } else {
      this.length = Number(opts.length) || Infinity
    }

    if (this.length !== Infinity) {
      this.lastChunkLength = this.length % this.chunkLength || this.chunkLength
      this.lastChunkIndex = Math.ceil(this.length / this.chunkLength) - 1
    }
  }

  async _getChunksDirHandle () {
    const storageDir = await this.storageDirPromise
    return await storageDir.getDirectoryHandle('chunks', { create: true })
  }

  async _getStorageDirectoryHandle () {
    const rootDir = await this.rootDirPromise
    return await rootDir.getDirectoryHandle(this.name, { create: true })
  }

  async _getChunk (index) {
    let chunk = this.chunks[index]

    if (!chunk) {
      const fileName = index.toString()
      const storageDir = await this.chunksDirPromise

      chunk = this.chunks[index] = { fileHandlePromise: storageDir.getFileHandle(fileName, { create: true }) }
    }

    return chunk
  }

  async _createFileHandle (opts) {
    const fileName = opts.path.slice(opts.path.lastIndexOf('/') + 1)
    return (await this._getDirectoryHandle(opts)).getFileHandle(fileName, { create: true })
  }

  // recursive, equiv of cd and mkdirp
  async _getDirectoryHandle (opts) {
    const lastIndex = opts.path.lastIndexOf('/')
    if (lastIndex === -1 || lastIndex === 0) return this.storageDirPromise
    const path = opts.path = opts.path.slice(0, lastIndex)
    if (!this.directoryMap[path]) {
      const parent = this._getDirectoryHandle(opts)
      this.directoryMap[path] = (await parent).getDirectoryHandle(path.slice(path.lastIndexOf('/') + 1), { create: true })
    }
    return this.directoryMap[path]
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

      if (!this.files) cb(null)
    })()

    if (this.files) {
      const targets = this.chunkMap[index]
      if (!targets) {
        queueMicrotask(() => cb(new Error('No files matching the request range')))
      }
      const promises = targets.map(target => {
        return (async () => {
          try {
            const { file } = target
            if (!file.stream) {
              file.stream = (await file.handle).createWritable({
                keepExistingData: true
              })
            }
            const stream = await file.stream
            await stream.write({ type: 'write', position: target.offset, data: buf.slice(target.from, target.to) })
            return null
          } catch (err) {
            return cb(err)
          }
        })()
      })
      Promise.all(promises).then(() => cb(null))
    }
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

    const rangeFrom = opts.offset || 0
    const rangeTo = opts.length ? rangeFrom + opts.length : chunkLength
    const len = opts.length || chunkLength - rangeFrom

    if (!this.files || this.chunks[index]) {
      ;(async () => {
        let buf
        try {
          const chunk = await this._getChunk(index)
          const fileHandle = await chunk.fileHandlePromise
          let file = await fileHandle.getFile()
          if (rangeFrom !== 0 || len !== chunkLength) {
            file = file.slice(rangeFrom, len + rangeFrom)
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

        cb(null, new Uint8Array(buf))
      })()
    } else {
      let targets = this.chunkMap[index]
      if (!targets) {
        queueMicrotask(() => cb(new Error('No files matching the request range')))
      }
      if (opts) {
        targets = targets.filter(target => {
          return target.to > rangeFrom && target.from < rangeTo
        })
        if (targets.length === 0) {
          queueMicrotask(() => cb(new Error('No files matching the request range')))
        }
      }
      if (rangeFrom === rangeTo) return queueMicrotask(() => cb(new Uint8Array(0)))

      const promises = targets.map(target => {
        return (async () => {
          let from = target.from
          let to = target.to
          let offset = target.offset

          if (opts) {
            if (to > rangeTo) to = rangeTo
            if (from < rangeFrom) {
              offset += (rangeFrom - from)
              from = rangeFrom
            }
          }
          try {
            const handle = await target.file.handle
            const file = (await handle.getFile()).slice(offset, offset + to - from)
            return await file.arrayBuffer()
          } catch (err) {
            return err
          }
        })()
      })
      Promise.all(promises).then(values => {
        if (values.length === 1) {
          cb(null, new Uint8Array(values[0]))
        } else {
          new Blob(values).arrayBuffer().then(buf => {
            cb(null, new Uint8Array(buf))
          })
        }
      })
    }
  }

  close (cb = () => {}) {
    if (this.closed) {
      queueMicrotask(() => cb(new Error('Storage is closed')))
      return
    }

    this.closed = true
    this.chunkMap = []
    this.directoryMap = {}

    this.cleanup()

    queueMicrotask(() => {
      cb(null)
    })
  }

  async cleanup () {
    if (this.files) {
      for (const file of this.files) {
        if (file.stream) {
          await (await file.stream).close()
          file.stream = null
        }
      }
      const storageDir = await this.storageDirPromise
      await storageDir.removeEntry('chunks', { recursive: true })
    }
    this.chunks = []
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
