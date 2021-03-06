
/**
 * Module dependencies
 */

var Stream = require('stream').Stream;

/**
 * expose
 * @ignore
 */

module.exports = exports = GridWriteStream;

/**
 * GridWriteStream
 *
 * @param {Grid} grid
 * @param {String} filename (optional)
 * @param {Object} options (optional)
 */

function GridWriteStream (grid, filename, options) {
  if (!(this instanceof GridWriteStream))
    return new GridWriteStream(grid, filename, options);

  Stream.call(this);
  this.writable = true;
  this._opened = false;
  this._opening = false;

  this._grid = grid;
  this.name = '';

  if (filename && filename.toHexString) {
    this.id = filename;
  } else if (this.id = grid.tryParseObjectId(filename)) {
    this.name = filename;
    // good to go
  } else {
    this.id = new grid.mongo.BSONPure.ObjectID;
    if ('string' == typeof filename) {
      // filenames are not unique
      // http://mongodb.github.com/node-mongodb-native/api-generated/gridstore.html
      this.name = filename;
    }
  }

  this.options = filename && 'Object' == filename.constructor.name
    ? filename
    : options || {};

  this.options.limit || (this.options.limit = Infinity);

  this.mode = this.options.mode && /^w[+]?$/.test(this.options.mode)
    ? this.options.mode
    : 'w+';

  this._q = [];
  this._store = new grid.mongo.GridStore(grid.db, this.id, this.name, this.mode, this.options);
}

/**
 * Inherit from Stream
 * @ignore
 */

GridWriteStream.prototype = { __proto__: Stream.prototype }

// public api

// TODO docs
GridWriteStream.prototype.writable;
GridWriteStream.prototype.name;
GridWriteStream.prototype.id;
GridWriteStream.prototype.options;
GridWriteStream.prototype.mode;

/**
 * write
 *
 * @param {Buffer|String} data
 */

GridWriteStream.prototype.write = function write (data) {
  if (!this.writable) {
    throw new Error('GridWriteStream is not writable');
  }

  // queue data until we open.
  if (!this._opened) {
    this._open();
    this._q.push(data);
    return false;
  }

  this._q.push(data);
  if (this._q.length > this.options.limit) {
    this._flush();
    return false;
  }

  this._flush();
  return true;
};

/**
 * end
 *
 * @param {Buffer|String} data
 */

GridWriteStream.prototype.end = function end (data) {
  // allow queued data to write before closing
  if (!this.writable) return;
  this.writable = false;

  if (data) {
    this._q.push(data);
  }

  var self = this;
  this.on('drain', function () {
    self._store.close(function (err, file) {
      if (err) return self._error(err);
      self.emit('close', file);
    });
  });

  this._flush();
};

/**
 * destroy
 */

GridWriteStream.prototype.destroy = function destroy () {
  // close and do not emit any more events. queued data is not sent.
  if (!this.writable) return;
  this.writable = false;
  this._q.length = 0;
  this.emit('close');
};

/**
 * destroySoon
 */

GridWriteStream.prototype.destroySoon = function destroySoon () {
  // as soon as write queue is drained, destroy.
  // may call destroy immediately if no data is queued.
  if (!this._q.length) {
    return this.destroy();
  }
  this._destroying = true;
};

// private api

/**
 * _open
 *
 * @api private
 */

GridWriteStream.prototype._open = function _open () {
  if (this._opening) return;
  this._opening = true;

  var self = this;
  this._store.open(function (err) {
    if (err) return self._error(err);
    self._opened = true;
    self.emit('open');
    self._flush();
  });
}

/**
 * _error
 *
 * @api private
 */

GridWriteStream.prototype._error = function _error (err) {
  this.destroy();
  this.emit('error', err);
}

/**
 * _flush
 *
 * @api private
 */

GridWriteStream.prototype._flush = function _flush (_force) {
  if (!this._opened) return;
  if (!_force && this._flushing) return;
  this._flushing = true;

  // write the entire q to gridfs
  if (!this._q.length) {
    this._flushing = false;
    this.emit('drain');

    if (this._destroying) {
      this.destroy();
    }
    return;
  }

  var self = this;
  this._store.write(this._q.shift(), function (err, store) {
    if (err) return self._error(err);
    self.emit('progress', store.position);
    self._flush(true);
  });
}

