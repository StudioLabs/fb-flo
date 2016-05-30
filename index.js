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
var WS = require('./src/server/ws');
var HTTP = require('./src/server/http');
var util = require("gulp-util");
var mkdirp = require('mkdirp');
var EventEmitter = require('events').EventEmitter;
var chalk = require('chalk');



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
		verbose: true,
		debug: false,
		memory : true
	}, options);

	this.config(options);

	this.watcher = [];

	this.file = [];
	this.url = [];
	this.src = [];
	this.tmp = [];

	var MemoryFileSystem = require("memory-fs");
	process.live = [];
	if(this.options.memory == true){
		process.fs = new MemoryFileSystem();
	}else{
		process.fs = fs;
		process.fs.mkdirpSync = mkdirp.sync;
	}

	this.log = logger(this.options.verbose, 'Live');
	this.debug = logger(this.options.debug, 'Live');

	this.rootDir = path.resolve( this.options.root || process.cwd()) + '/';

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
			log: this.options.verbose ,
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

	if (options.directory == undefined) {
		util.log(util.colors.yellow("please define a source directory"));
		process.exit(0);
	}

	options.directory = path.resolve(options.directory);
	options.destination = path.resolve(options.destination || options.directory) ;

	var wsConfig = _.assign({
		port: this.options.port,
		log: this.options.verbose,
		debug: this.options.debug,
		parent: this
	}, options);

	this.ws = new WS(wsConfig);
	this.ws.start();

	this.options.devtools = options;

	var through = require('through');

	if (options.plugin !== undefined) {
		this.initPlugins(options.plugin);
	}

	this.stream = through(function() {
	    this.pause();
	  });

	return this.stream;

};

/**
 * Init Resolvers
 *
 * @private
 */
Live.prototype.initPlugins = function(plugins) {

	this.streams = [];

    plugins.map(function (plugin, i) {
    	this.streams[i] = plugin.stream = i;
		plugin.init(this);
    }.bind(this));
};


Live.prototype.streamFinished = function(plugin) {

	this.streams = this.streams.filter(function(e){return e!==plugin.stream});

	if(this.streams.length == 0){
		this.stream.emit('end');
	}


}


/**
 * Start watching files
 *
 * @private
 */
Live.prototype.watch = function(options) {

	for (var folder  in options) {
		var params = options[folder];
		params =  _.assign({
			files:  []
		}, params);

		var folderPath = path.resolve(folder);
		this.watcher[folder] = new sane(folderPath, {
			glob: params.files
		});

		this.watcher[folder].on('change', function(filepath, root){
			this.fileEvent(root+'/'+filepath);
		}.bind(this));
		this.watcher[folder].on('error', this.onError, this);
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

Live.prototype.onFileChange = function(filepath) {
	if(this.file[filepath] !== undefined ){
		if(this.file[filepath].plugin !== undefined ){
			return this.file[filepath].plugin.resolve(this,this.file[filepath]);
		}
	}else{
		var fileUrl = filepath.replace(this.options.devtools.directory + '/', '');

		return this.resolve(filepath, fileUrl) ;
	}
};

/**
 * default resolve method.
 *
 * @param {string} filepath
 * @private
 */

Live.prototype.resolve = function(filepath, fileUrl) {

	if(fs.existsSync(filepath)){
		this.log('update', filepath);

		this.broadcast({
			action: 'update',
			url: fileUrl,
			content: fs.readFileSync(filepath).toString()
		});
	}


};



/**
 * Handles message
 *
 * @param {string} message (charset : base64)
 * @private
 */

Live.prototype.onMessage = function(message) {
	this.debug('message', message);

	if (message.action == 'update') {
		this.onUpdateAction(message);
	}else if (message.action == 'sync') {
		this.onSyncAction(message);
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
	var url = message.src;
	this.debug('update',url);

	var file;
	if (this.url[url] !== undefined) {
		file = this.url[url];
	}else if (this.src[url] !== undefined) {
		file = this.src[url];
	}

	if (file !== undefined) {
		file.content = message.content;
		fs.writeFileSync(file.path, message.content);
	}else {
		var filepath = this.options.devtools.directory + '/' + url;
		 if(fs.existsSync(filepath)){
			var content = fs.readFileSync(filepath).toString();
			if( content != message.content ){
				fs.writeFileSync(filepath, message.content);
			}
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
	var url = message.src;
	this.debug('sync',url);

	var file;
	if (this.url[url] !== undefined) {
		file = this.url[url];
	}else if (this.src[url] !== undefined) {
		file = this.src[url];
	}
	if (file !== undefined) {
		if (file.sync !== undefined) {
			originalFileContent = file.sync;
			delete file.sync;
		}else{
			var originalFileContent = fs.readFileSync(file.path, 'utf8');
		}

		var record = {
			action: 'sync',
			url: url,
			content: originalFileContent
		};

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

	if(this.ws !== undefined  && this.ws.connected == true){
		this.broadcast({
			action :'reload'
		});
	}else{
		require("opn")(url, name || null);
	}
};

/**
 * Creates a logger for a given module.
 *
 * @param {boolean} verbose
 * @param {string} moduleName
 * @private
 */

/**
 * send error to the client
 *
 * @param {string} filepath
 * @private
 */

Live.prototype.error = function(error) {
	this.debug('error', error);

	if(error.annotated !== undefined){
		error.message = error.annotated;
	}

	if(error.codeFrame !== undefined){
		error.message = error.message.replace(': ' , ':\n') + '\n'+error.codeFrame;
	}

	if(error.filename !== undefined){
		error.file = error.filename;
	}

	if(error.loc !== undefined){
		error.line = error.loc.line;
	}

	if(error.message !== undefined){

		var errorMessage = {
			action: 'error',
			message :  error.message
		};

		if(error.file !== undefined ){

			var filepath = path.resolve(error.file);
			if(this.file[filepath] !== undefined ){

			 	var file = this.file[filepath];
				var url  = this.getClientHostname()+'/'+file.src;

				var fileLine =  error.message.split('\n')[0];

				if(fileLine.indexOf(file.src)>=0){
					errorMessage.message = error.message.replace(fileLine, url);
				}else if(fileLine.indexOf(file.url)>=0){
					errorMessage.message = error.message.replace(fileLine, url);
				}else{
					errorMessage.message = url+'\n'+error.message;
				}


				if(error.line!= undefined && error.line > 0){
					errorMessage.message = errorMessage.message.replace(url, url+':'+error.line);
				}

				var fileName = path.basename(file.path);
				errorMessage.message =    errorMessage.message.replace(file.path, fileName);


				errorMessage.url = url;
				errorMessage.src = file.src;

				errorMessage.content = fs.readFileSync(file.path).toString();
			}
		}

		errorMessage.message =    chalk.stripColor(errorMessage.message);

		this.broadcast(errorMessage);

		console.log('[error]');
		console.log(errorMessage.message);

	}
};


/**
 * Get Client hostname.
 *
 * @public
 */

Live.prototype.getClientHostname = function() {

	if(this.options.devtools.hostname !== undefined) return this.options.devtools.hostname;

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
 * Register a File.
 *
 * @public
 */
Live.prototype.registerFile = function(file) {

	var alreadyPresent = (this.file[file.path] !== undefined);

	this.url[file.url] = file;
	this.src[file.src] = file;
	this.file[file.path] = file;
	if(file.tmp !== undefined){
		this.tmp[file.tmp] = file;
	}

	return alreadyPresent;


};
/**
 * Stop watching
 *
 * @private
 */

Live.prototype.stopWatching = function(cb) {
	var self = this;
	this.watcher.forEach(function(watch, folder) {
		watch.close();
		self.debug("stop watching ", folder);
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
	if(this.ws.hostname != null){
		this.debug('broadcast', message);
		this.ws.broadcast(message);
	}else{
		this.debug('broadcast canceled, no connection with a client');
	}
};


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
