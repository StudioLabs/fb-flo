/**
 *  Copyright (c) 2014, StudioLabs, Inc.
 *  All rights reserved.
 *
 *  This source code is licensed under the BSD-style license found in the
 *  LICENSE file in the root directory of this source tree. An additional grant
 *  of patent rights can be found in the PATENTS file in the same directory.
 */

'use strict';

var http = require('http');
var path = require('path');
var fs = require('fs');
var EventEmitter = require('events').EventEmitter;
var connect = require("connect");
var util = require("gulp-util");
var middlewareDevTools = require("devtools-live-middleware");

module.exports = HttpServer;

/**
 * Starts an http server with the given options and attaches a websocket server
 * to it.
 *
 * @class Server
 * @param {object} options
 */

function HttpServer(options) {
	this.sockets = [];
	this.options = options;
	this.log = this.logger(options.verbose, 'HTTP');
	this.debug = this.logger(options.debug, 'HTTP');
	this.parent = options.parent;
	this.port = options.port || "8080";

	if (options.root == undefined) {
		util.log(util.colors.yellow("please define a server root"));
		process.exit(0);
	}

	this.root = path.resolve(options.root) ;
	this.fallback = options.fallback || this.root + '/index.html' ;

	this.host = options.host || "localhost";

	this.app = connect();

	var options = {
			dir: this.root,
			aliases: [
				['/', '/index.html'],
			],
			ignoreFile: function(fullPath) {
				var basename = path.basename(fullPath);
				return /^\./.test(basename) || /~$/.test(basename);
			},
			followSymlinks: true,
			cacheControlHeader: "max-age=0, must-revalidate",
		};

	this.app.use('/', middlewareDevTools(this.root));

	this.httpServer = http.createServer(this.app);
	this.httpServer.on('close', this.onClose.bind(this));
	this.httpServer.on('connection', this.onConnection.bind(this));
	this.httpServer.on('request', this.onRequest.bind(this));
}

/**
 * Start Websocket Server.
 *
 * @private
 */
HttpServer.prototype.start = function() {
	this.log("starting http://" + this.host + ":" + this.port);

	this.httpServer.listen(this.options.port, function(err) {
		if (err) {
			return this.log("Error : " + err);
		}

		this.parent.emit('ready');
		this.log("ready");
		if (this.options.open === true) {
			this.parent.open("http://" + this.host + ":" + this.port);
		}

	}.bind(this));
};

HttpServer.prototype.__proto__ = EventEmitter.prototype;

HttpServer.prototype.onRequest = function(request) {
	this.debug("Received request " + request.method + " " + request.url);

};

HttpServer.prototype.onConnection = function(socket) {
	this.sockets.push(socket);
	return socket.on("close", function() {
		return this.sockets.splice(this.sockets.indexOf(socket), 1);
	}.bind(this));
};

HttpServer.prototype.onClose = function() {
	this.debug("shutting down...");
	this.sockets.forEach(function(socket) {
		return socket.destroy();
	});
};

/**
 * Close the server.
 *
 * @public
 */

HttpServer.prototype.close = function() {
	this.httpServer.close();
};

HttpServer.prototype.logger = function(verbose, moduleName) {
	var slice = [].slice;
	return function() {
		var args = slice.call(arguments);
		args[0] = '[' + moduleName + '] ' + args[0];
		if (verbose) {
			console.log.apply(console, args);
		}
	}
};
