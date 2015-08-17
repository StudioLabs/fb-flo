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
var EventEmitter = require('events').EventEmitter;
var serveStatic = require('serve-static');
var connect = require("connect");
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
	this.parent = options.parent;
	this.port = options.port || "8080";

	if (options.root == undefined) {
		util.log(util.colors.yellow("please define a server root"));
		process.exit(0);
	}

	this.root = path.resolve(options.root) ;
	this.dir = options.dir || [];
	this.dir.push(this.root);
	this.host = options.host || "localhost";

	this.app = connect();

	this.dir.forEach(function(path) {
		this.app.use(serveStatic(path));
	}.bind(this));

	this.server = http.createServer(this.app);

	this.httpServer = http.createServer(function(req, res) {
		res.writeHead(404);
		res.end();
	});

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
			return this.log("Error on starting http server: " + err);
		}
	}.bind(this));
};

HttpServer.prototype.onReady = function() {
	this.parent.emit('ready');
	process.on("SIGINT", this.httpServer.stop);
	process.on("exit", this.httpServer.stop);
	this.log("Http Server started http://" + this.host + ":" + this.port);
};

HttpServer.prototype.stop = function() {
	server.close();
	return process.nextTick(function() {
		return process.exit(0);
	});
};

HttpServer.prototype.__proto__ = EventEmitter.prototype;

HttpServer.prototype.onRequest = function(request) {
	this.log("Received request " + request.method + " " + request.url);

};

HttpServer.prototype.onConnection = function(socket) {
	this.sockets.push(socket);
	return socket.on("close", function() {
		return this.sockets.splice(this.sockets.indexOf(socket), 1);
	}.bind(this));
};

HttpServer.prototype.onClose = function() {
	this.log("[Http server] shutting down...");
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
