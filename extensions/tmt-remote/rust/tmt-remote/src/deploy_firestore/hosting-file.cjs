// One integrity-checked file reader and deterministic streaming gzip implementation for capture/upload.
// No Firebase module, credentials, HTTP, application state, or manifest-selected root.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const CHUNK_BYTES = 64 * 1024;
function invalid() {
  throw new Error('Hosting file integrity could not be verified');
}
// Native capture owns root confinement. This reread owns byte identity: check the
// opened regular-file handle before any upload, even if an ancestor changed meanwhile.
function verifyDescriptor(fd, reference) {
  const { path: filename, length, sha256 } = reference;
  if (
    typeof filename !== 'string' ||
    !path.isAbsolute(filename) ||
    filename
      .split('/')
      .slice(1)
      .some((p) => !p || p === '.' || p === '..') ||
    !Number.isSafeInteger(length) ||
    length < 0 ||
    typeof sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(sha256)
  )
    invalid();
  const metadata = fs.fstatSync(fd);
  if (!metadata.isFile() || metadata.size !== length) invalid();
  const digest = crypto.createHash('sha256');
  const buffer = Buffer.allocUnsafe(CHUNK_BYTES);
  let offset = 0;
  while (offset <= length) {
    const count = fs.readSync(fd, buffer, 0, Math.min(buffer.length, length - offset + 1), offset);
    if (!count) break;
    digest.update(buffer.subarray(0, count));
    offset += count;
  }
  if (offset !== length || fs.fstatSync(fd).size !== length || digest.digest('hex') !== sha256)
    invalid();
}
function open(reference) {
  const fd = fs.openSync(
    reference.path,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK
  );
  try {
    verifyDescriptor(fd, reference);
    return fd;
  } catch (error) {
    fs.closeSync(fd);
    throw error;
  }
}
function source(fd, reference) {
  return Readable.from(
    (function* () {
      const digest = crypto.createHash('sha256');
      let offset = 0;
      while (offset <= reference.length) {
        const buffer = Buffer.allocUnsafe(Math.min(CHUNK_BYTES, reference.length - offset + 1));
        const count = fs.readSync(fd, buffer, 0, buffer.length, offset);
        if (!count) break;
        offset += count;
        if (offset > reference.length) invalid();
        const bytes = buffer.subarray(0, count);
        digest.update(bytes);
        yield bytes;
      }
      if (
        offset !== reference.length ||
        fs.fstatSync(fd).size !== reference.length ||
        digest.digest('hex') !== reference.sha256
      )
        invalid();
    })()
  );
}
function canonicalGzip() {
  let header = Buffer.alloc(0);
  let complete = false;
  return new Transform({
    transform(chunk, _encoding, callback) {
      if (complete) return callback(null, chunk);
      header = Buffer.concat([header, chunk]);
      if (header.length < 10) return callback();
      header[9] = 255;
      complete = true;
      callback(null, header);
    },
    flush(callback) {
      callback(complete ? null : new Error('Incomplete gzip header'));
    },
  });
}
async function prepare(reference) {
  const fd = open(reference);
  const digest = crypto.createHash('sha256');
  let length = 0;
  try {
    await pipeline(
      source(fd, reference),
      zlib.createGzip({ level: 6 }),
      canonicalGzip(),
      new Transform({
        transform(bytes, _encoding, done) {
          length += bytes.length;
          digest.update(bytes);
          done();
        },
      })
    );
    return { sha256: digest.digest('hex'), length };
  } finally {
    fs.closeSync(fd);
  }
}
// Caller owns close even if HTTP refuses before consuming the body. Stream errors are failures,
// never permission to release a partially uploaded version or to repeat the mutation.
function upload(reference, expected) {
  const fd = open(reference);
  let closed = false;
  const close = () => {
    if (!closed) {
      closed = true;
      fs.closeSync(fd);
    }
  };
  const digest = crypto.createHash('sha256');
  let length = 0;
  const output = new Transform({
    transform(bytes, _encoding, done) {
      length += bytes.length;
      digest.update(bytes);
      done(null, bytes);
    },
    flush(done) {
      const matches = length === expected.length && digest.digest('hex') === expected.sha256;
      done(matches ? null : new Error('Hosting upload identity changed'));
    },
  });
  // pipeline owns error propagation through the body; the promise is observed immediately.
  const completion = pipeline(
    source(fd, reference),
    zlib.createGzip({ level: 6 }),
    canonicalGzip(),
    output
  ).finally(close);
  completion.catch(() => {});
  return { body: output, completion, close };
}
module.exports = { prepare, upload };
