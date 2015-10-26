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
 * Event emitter factory
 * @returns {EventEmitter}
 */
function newEmitter() {
	var emitter = new EventEmitter();
	emitter.setMaxListeners(20);
	return emitter;
}

/**
 * Top-level API for Live. Defaults params and instantiates `Live`.
 *
 * @param {string} dir
 * @param {object} options
 * @param {function} callback
 * @return {Live}
 * @public
 */

function Live(options) {

	this.options = {};

	var options =  _.assign({
		port:8888,
		verbose: false,
		debug: false,
		name: 'Live - ' + new Date().getTime(),
		emitter: newEmitter()
	}, options);

	this.config(options);

	this.events  = this.options.emitter;
	this.name = this.options.name;

	this.watch = [];
	this.resolve = [];

	this.active = false;
	this.paused = true;

	this.log = logger(this.options.verbose, 'Live');
	this.onError = this.error.bind(this);
	this.fileEvent = this.onFileChange.bind(this);

	process.on("SIGINT", this.stop.bind(this));
	process.on("exit", this.stop.bind(this));

}

/**
 * Start watching
 *
 * @private
 */
Live.prototype.config = function(options) {

	this.options = _.assign(this.options, options);

};

/**
 * Starts the server and the watcher and handles the piping between
 *
 * @param {object} options
 * @class Live
 * @private
 */

Live.prototype.__proto__ = EventEmitter.prototype;

/**
 * Start Live server
 *
 * @private
 */

Live.prototype.start = function(options) {

	if (options !== undefined) {
		this.config(options);
	}

	if (this.options.devtools !== undefined) {
		this.devtools(this.options.devtools);
	}

	if (this.options.connect !== undefined) {
		this.connect(this.options.connect);
	}

	if (this.options.watch !== undefined) {
		this.watch(this.options.watch);
	}

};

/**
 * Start HTTP server
 *
 * @private
 */

Live.prototype.connect = function(options) {

	var httpConfig = _.assign({
			log: this.options.verbose,
			debug: this.options.debug,
			open: false,
			parent: this
		}, options);

	this.http = new HTTP(httpConfig);

	this.http.start();

	this.options.connect = options;

};

/**
 * Start WS Devtools Server
 *
 * @private
 */

Live.prototype.devtools = function(options) {

	options.src = path.resolve(options.src);
	options.dest = path.resolve(options.dest);

	var wsConfig = _.assign({
		port: this.options.port,
		log: this.options.verbose,
		debug: this.options.debug,
		reload: false,
		parent: this
	}, options);

	this.ws = new WS(wsConfig);
	this.ws.start();

	this.options.devtools = options;

	if (options.resolve !== undefined) {
		this.initResolvers(options.resolve);
	}

};

/**
 * Init Resolvers
 *
 * @private
 */
Live.prototype.initResolvers = function(resolvers) {
	for (var extension  in resolvers) {
		this.resolve[extension] = this.loadResolver(resolvers[extension]);
		if (extension.map !== undefined && fs.existsSync(extension.map)) {
			this.loadMap(extension.map);
		}
	}
};

/**
 * Start watching files
 *
 * @private
 */
Live.prototype.watch = function(options) {

	for (var folder  in options) {
		var params = options[folder];
		params =  _.assign({
			files:  [],
			useWatchman: false,
			useFilePolling:  false,
			watchDotFiles: false
		}, params);

		this.watch[folder] = new sane(path.resolve(folder), {
			glob: params.files,
			poll: params.useFilePolling,
			interval: params.pollingInterval,
			watchman: params.useWatchman,
			dot: params.watchDotFiles
		});
		this.watch[folder].on('change', this.fileEvent);
		this.watch[folder].on('error', this.onError);
		this.log("start watching ", folder);
	}

	this.options.watch = options;
};

/**
 * Handles file changes.
 *
 * @param {string} filepath
 * @private
 */

Live.prototype.onFileChange = function(filepath, root) {
	var extension = path.extname(filepath);
	this.fileUrl = filepath.replace(this.options.devtools.src + '/', '');

	this.log('File changed', filepath, this.fileUrl);

	if (this.ws !== undefined) {
		if (this.resolve[extension] !== undefined) {
			this.resolve[extension].resolve(filepath, this.fileUrl, this, this.onError);
		}else {
			this.resolve(filepath, this.fileUrl) ;
		}
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
	var error = _.pick(error, ['message', 'file',  'line']);
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
		contents: fs.readFileSync(this.options.devtools.src + '/' + filepath)
	});
};

/**
 * Get Client hostname.
 *
 * @public
 */

Live.prototype.getClientHostname = function() {
	var hostname = this.ws.hostname;
	try {

		if (hostname[hostname.length - 1] == '/') {
			hostname = hostname.substr(0, hostname.length - 1);
		}

	}catch (err) {
		this.onError(err);
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
	this.log('broadcast', message);

	this.ws.broadcast(message);
};

/**
 * Handles message
 *
 * @param {string} message (charset : base64)
 * @private
 */

Live.prototype.onMessage = function(message) {
	this.log(message.action, message);

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
	var originalFilePath = this.options.devtools.src + '/' + message.url.replace(this.getClientHostname() + '/', '');

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
	var originalFilePath = this.options.devtools.src + '/' + url;
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

	if (this.ws !== undefined) {
		this.ws.close();
	}

	if (this.options.watch !== undefined) {
		this.stopWatching();
	}

	if (this.http !== undefined) {
		this.http.close();
	}

};

/**
 * Start watching
 *
 * @private
 */
Live.prototype.stop = function() {
	this.close();
	process.nextTick(function() {
		return process.exit(0);
	});
};


/**
* Wrapper for open module - for easier stubbin'
* @param url
* @param name
*/

Live.prototype.open = function(url, name) {
	require("opn")(url, name || null);
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
