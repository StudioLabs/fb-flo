/**
 *  Copyright (c) 2014, StudioLabs, Inc.
 *  All rights reserved.
 *
 *  This source code is licensed under the BSD-style license found in the
 *  LICENSE file in the root directory of this source tree. An additional grant
 *  of patent rights can be found in the PATENTS file in the same directory.
 */

'use strict';

var fs = require('fs');
var path = require('path');
var utf8 = require('utf8');
var _ = require('lodash');
var sane = require('sane');
var assert = require('assert');
var Server = require('./server');
var EventEmitter = require('events').EventEmitter;


/**
 * Top-level API for liveEdit. Defaults params and instantiates `LiveEdit`.
 *
 * @param {string} dir
 * @param {object} options
 * @param {function} callback
 * @return {LiveEdit}
 * @public
 */

function liveEdit(config) {
  config =  _.assign({
      port :8888,
      verbose : false,
      dest : './',
      src : './',
      watchers: [],
      resolvers : []
  }, config);

  return new LiveEdit(config);
}

/**
 * Time before we emit the ready event.
 */

var DELAY = 200;

/**
 * Starts the server and the watcher and handles the piping between 
 *
 * @param {object} options
 * @class LiveEdit
 * @private
 */

function LiveEdit(options) {
  this.options = options;
  this.watchers=[];
  this.resolvers=[];

  this.src = path.resolve(options.src);

  this.dest = path.resolve(options.dest);

  this.log = logger(options.verbose, 'LiveEdit');

  this.server = new Server({
    port: options.port,
    log: logger(options.verbose, 'Server'),
    parent : this
  });
  this.server.on('message', this.onMessage.bind(this));

  this.fileEvent = this.onFileChange.bind(this);

  this.init();
}

LiveEdit.prototype.__proto__ = EventEmitter.prototype;

/**
 * Handles file changes.
 *
 * @param {string} filepath
 * @private
 */

LiveEdit.prototype.onFileChange = function(filepath,root) {
    filepath = this.src+'/'+root.replace(this.src + '/', '')+'/'+filepath;
    var extension = path.extname(filepath);
    this.fileUrl = filepath.replace(this.src + '/', '');

    this.log('File changed',filepath, this.fileUrl);
    if(this.resolvers[extension] !== undefined){
      this.resolvers[extension].resolve(filepath, this.fileUrl, this, this.error.bind(this));
    }else{
      this.resolve(filepath, this.fileUrl) ;
    }
  
};

/**
 * send error to the client
 *
 * @param {string} filepath
 * @private
 */

LiveEdit.prototype.error = function(error) {
  this.log('error',error);
  this.broadcast({
      action : 'error',
      resourceURL : this.fileUrl,
      contents : error
    });
};

/**
 * default resolve method.
 *
 * @param {string} filepath
 * @private
 */

LiveEdit.prototype.resolve = function(filepath, fileUrl) {
  this.log('resolve',filepath, fileUrl);
    this.broadcast({
      resourceURL: fileUrl,
      contents: fs.readFileSync(this.src+'/'+filepath)
    });
};

/**
 * Get Client hostname.
 *
 * @public
 */

LiveEdit.prototype.getClientHostname = function() {
   var hostname = this.server.hostname;
   if(hostname[hostname.length-1] == '/'){
      hostname = hostname.substr(0,hostname.length-1);
    }
    return hostname;
};

/**
 * Get Client page url.
 *
 * @public
 */

LiveEdit.prototype.getClientPageUrl = function() {
    return this.server.pageUrl;
};


/**
 * Start watching
 *
 * @private
 */
LiveEdit.prototype.init = function() {

  for (var extension  in this.options.resolvers) {
    var options = this.options.resolvers[extension];
    this.resolvers[extension] = this.loadResolver(options);
  }

  for (var folder  in this.options.watchers) {
    var options = this.options.watchers[options];
     options =  _.assign({
        files:  [],
        useWatchman: false,
        useFilePolling:  false,
        watchDotFiles: false
    }, options);

    this.watchers[folder] = new sane( path.resolve(folder), {
      glob: options.files,
      poll: options.useFilePolling,
      interval: options.pollingInterval,
      watchman: options.useWatchman,
      dot: options.watchDotFiles
    });
    this.watchers[folder].on('change', this.fileEvent);
    this.watchers[folder].on('error', this.emit.bind(this, 'error'));
    this.log("start watching ",folder);
  }

};


/**
 * load resolver
 *
 * @private
 */
LiveEdit.prototype.loadResolver = function(config) {
    if(typeof config === 'function'){
          return config;
    }else if(typeof config === 'object'){
        var resolver = require('./resolver/'+config.resolver)
        return new resolver(config);
    }
};

/**
 * Stop watching
 *
 * @private
 */

LiveEdit.prototype.stopWatching = function(cb) {
    var self = this;
     this.watchers.forEach(function(watch, folder){
        watch.close();
        self.log("stop watching ",folder);
    }.bind(this));
     if(cb !== undefined){
        cb();
    }
};


/**
 * Brodcast a message.
 *
 * @param {object} message
 * @private
 */

LiveEdit.prototype.broadcast = function(message) {
    this.server.broadcast(message);
};

/**
 * Handles message
 *
 * @param {string} message (charset : base64)
 * @private
 */

LiveEdit.prototype.onMessage = function(message) {
   // this.log(message.action,message);

  if(message.action == 'update'){
    this.onUpdateAction(message);
  }else if(message.action == 'sync'){
    this.onSyncAction(message);
  }else if(message.action == 'update'){
    this.onUpdateAction(message);
  }else{
    this.emit(message.action, message);
  }
};


/**
 * Handles Update Action
 *
 * @param {string} message (charset : base64)
 * @private
 */

LiveEdit.prototype.onUpdateAction = function(message) {
  var extension = path.extname(message.url);
  var originalFilePath = this.src + '/' + message.url.replace(this.getClientHostname() + '/', '');
  
  if (this.resolvers[extension] !== undefined) {
    var index = this.resolvers[extension].index;
  if (index[originalFilePath] !== undefined) {
      var file = index[originalFilePath];
      file.content = utf8.encode(message.content);
      fs.writeFileSync(originalFilePath, file.content);
    }     
  }
};

/**
 * Handles Sync Action
 *
 * @param {string} message (charset : base64)
 * @private
 */

LiveEdit.prototype.onSyncAction = function(message) {
  var extension = path.extname(message.url);
  var originalFileContent = '';
  var url = message.url.replace(this.getClientHostname() + '/', '');
  var originalFilePath = this.src + '/' + url;
  if (this.resolvers[extension] !== undefined) {
    var index = this.resolvers[extension].index;
    if (index[originalFilePath] !== undefined) {
      var file = index[originalFilePath];
      if (index[originalFilePath].sync !== undefined) {
        originalFileContent = index[originalFilePath].sync;
        delete index[originalFilePath].sync;
      }
    }

    var record = {
      action: 'sync',
      resourceURL: url,
      content: originalFileContent
    };
    record.resourceName = message.url;

    this.broadcast(record);

  }

};

/**
 * Closes the server and the watcher.
 *
 * @public
 */

LiveEdit.prototype.close = function() {
  this.log('Shutting down liveEdit');
  this.stopWatching();
  this.server.close();
};

/**
 * Creates a logger for a given module.
 *
 * @param {boolean} verbose
 * @param {string} moduleName
 * @private
 */

function logger(verbose, moduleName) {
  var slice = [].slice;
  return function() {
    var args = slice.call(arguments);
    args[0] = '[' + moduleName + '] ' + args[0];
    if (verbose) {
      console.log.apply(console, args);
    }
  }
}


module.exports = liveEdit;
