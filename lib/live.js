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
var WS = require('./server/ws');
var HTTP = require('./server/http');
var EventEmitter = require('events').EventEmitter;

/**
 * Top-level API for Live. Defaults params and instantiates `Live`.
 *
 * @param {string} dir
 * @param {object} options
 * @param {function} callback
 * @return {Live}
 * @public
 */

function Live(config) {
	config =  _.assign({
		port:8888,
		verbose: false,
		debug: false,
		resolve: []
	}, config);

	return new Live(config);
}

/**
 * Time before we emit the ready event.
 */

var DELAY = 200;

/**
 * Starts the server and the watcher and handles the piping between
 *
 * @param {object} options
 * @class Live
 * @private
 */

function Live(options) {
	this.options = options;
	this.watch = [];
	this.resolve = [];
	this.fileEvent = this.onFileChange.bind(this);
	this.log = logger(this.options.verbose, 'Live');

	this.src = path.resolve(this.options.src);
	this.dest = path.resolve(this.options.dest);

	this.start();
}

Live.prototype.__proto__ = EventEmitter.prototype;

/**
 * Start watching
 *
 * @private
 */
Live.prototype.start = function() {

	if(this.options.resolve !==){
		this.initResolvers();
	}

	if (this.options.server !== undefined) {
		var httpConfig = _.assign({
			log: logger(this.options.debug, 'HTTP'),
			parent: this
		}, this.options.server);

		this.http = new HTTP(httpConfig);

		this.http.start();
	}

	var wsConfig = _.assign({
		port: this.options.port,
		log: logger(this.options.debug, 'WS'),
		parent: this
	}, this.options.resolve);

	this.ws = new WS(wsConfig);
	this.ws.on('message', this.onMessage.bind(this));

	this.ws.start();

	if (this.options.watch !== undefined) {
		this.startWatching();
	}

};


/**
 * Init Resolvers
 *
 * @private
 */
Live.prototype.initResolvers = function() {
	for (var extension  in this.options.resolve) {
		this.resolve[extension] = this.loadResolver(this.options.resolve[extension]);
	}
};

/**
 * Start watching
 *
 * @private
 */
Live.prototype.startWatching = function() {

	for (var folder  in this.options.watch) {
		var options = this.options.watch[options];
		options =  _.assign({
			files:  [],
			useWatchman: false,
			useFilePolling:  false,
			watchDotFiles: false
		}, options);

		this.watch[folder] = new sane(path.resolve(folder), {
			glob: options.files,
			poll: options.useFilePolling,
			interval: options.pollingInterval,
			watchman: options.useWatchman,
			dot: options.watchDotFiles
		});
		this.watch[folder].on('change', this.fileEvent);
		this.watch[folder].on('error', this.emit.bind(this, 'error'));
		this.log("start watching ", folder);
	}
};
/**
 * Handles file changes.
 *
 * @param {string} filepath
 * @private
 */

Live.prototype.onFileChange = function(filepath, root) {
	filepath = this.src + '/' + root.replace(this.src + '/', '') + '/' + filepath;
	var extension = path.extname(filepath);
	this.fileUrl = filepath.replace(this.src + '/', '');

	this.log('File changed', filepath, this.fileUrl);
	if (this.resolve[extension] !== undefined) {
		this.resolve[extension].resolve(filepath, this.fileUrl, this, this.error.bind(this));
	}else {
		this.resolve(filepath, this.fileUrl) ;
	}
};

/**
 * send error to the client
 *
 * @param {string} filepath
 * @private
 */

Live.prototype.error = function(error) {
	this.log('error', error);
	this.broadcast({
		action: 'error',
		resourceURL: this.fileUrl,
		contents: error
	});
};

/**
 * default resolve method.
 *
 * @param {string} filepath
 * @private
 */

Live.prototype.resolve = function(filepath, fileUrl) {
	this.log('resolve', filepath, fileUrl);
	this.broadcast({
		resourceURL: fileUrl,
		contents: fs.readFileSync(this.src + '/' + filepath)
	});
};

/**
 * Get Client hostname.
 *
 * @public
 */

Live.prototype.getClientHostname = function() {
	var hostname = this.ws.hostname;
	if (hostname[hostname.length - 1] == '/') {
		hostname = hostname.substr(0, hostname.length - 1);
	}

	return hostname;
};

/**
 * Get Client page url.
 *
 * @public
 */

Live.prototype.getClientPageUrl = function() {
	return this.ws.pageUrl;
};

/**
 * load resolver
 *
 * @private
 */
Live.prototype.loadResolver = function(config) {
	if (typeof config === 'function') {
		return config;
	}else if (typeof config === 'object') {
		var resolver = require('./resolver/' + config.resolver)
		return new resolver(config);
	}
};

/**
 * Stop watching
 *
 * @private
 */

Live.prototype.stopWatching = function(cb) {
	var self = this;
	this.watch.forEach(function(watch, folder) {
		watch.close();
		self.log("stop watching ", folder);
	}.bind(this));
	if (cb !== undefined) {
		cb();
	}
};

/**
 * Brodcast a message.
 *
 * @param {object} message
 * @private
 */

Live.prototype.broadcast = function(message) {
	this.ws.broadcast(message);
};

/**
 * Handles message
 *
 * @param {string} message (charset : base64)
 * @private
 */

Live.prototype.onMessage = function(message) {
	// this.log(message.action,message);

	if (message.action == 'update') {
		this.onUpdateAction(message);
	}else if (message.action == 'sync') {
		this.onSyncAction(message);
	}else if (message.action == 'update') {
		this.onUpdateAction(message);
	}else {
		this.emit(message.action, message);
	}
};

/**
 * Handles Update Action
 *
 * @param {string} message (charset : base64)
 * @private
 */

Live.prototype.onUpdateAction = function(message) {
	var extension = path.extname(message.url);
	var originalFilePath = this.src + '/' + message.url.replace(this.getClientHostname() + '/', '');

	if (this.resolve[extension] !== undefined) {
		var index = this.resolve[extension].index;
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

Live.prototype.onSyncAction = function(message) {
	var extension = path.extname(message.url);
	var originalFileContent = '';
	var url = message.url.replace(this.getClientHostname() + '/', '');
	var originalFilePath = this.src + '/' + url;
	if (this.resolve[extension] !== undefined) {
		var index = this.resolve[extension].index;
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

Live.prototype.close = function() {
	this.log('exiting...');
	this.ws.close();

	if(this.options.watch !== undefined){
		this.stopWatching();
	}

	if(this.options.server !== undefined){
		this.http.close();
	}

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

module.exports = Live;
