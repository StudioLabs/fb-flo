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
var createStatic = require('connect-static');
var util = require("gulp-util");

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
	this.log = options.log || function() {};
	this.debug = options.debug || function() {};
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

	createStatic(options, function(err, middleware) {
		if (err) throw err;
		this.app.use('/', middleware);
	}.bind(this));

	this.httpServer = http.createServer(this.app);
	this.httpServer.on('listening', this.onReady.bind(this));
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
	this.httpServer.listen(this.options.port, function(err) {
		if (err) {
			return this.log("Error : " + err);
		}

	}.bind(this));
};

HttpServer.prototype.onReady = function() {
	this.parent.emit('ready');
	this.log("starting http://" + this.host + ":" + this.port);
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

    /**
     * Open the page in browser
     * @param {String} url
     * @param {Object} options
     */

HttpServer.prototype.openBrowser = function(url, options) {

	var open    = options.get("open");
	var browser = options.get("browser");

	if (_.isString(open)) {
		if (options.getIn(["urls", open])) {
			url = options.getIn(["urls", open]);
		}
	}

	if (open) {
		if (browser !== "default") {
			if (utils.isList(browser)) {
				browser.forEach(function(browser) {
					utils.open(url, browser);
				});
			} else {
				utils.open(url, browser); // single
			}
		} else {
			utils.open(url);
		}
	}
};
/**
* Wrapper for open module - for easier stubbin'
* @param url
* @param name
*/

HttpServer.prototype.open = function(url, name) {
	require("opn")(url, name || null);
};
