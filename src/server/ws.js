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
var WSS = require('websocket').server;
var EventEmitter = require('events').EventEmitter;

module.exports = WSServer;

/**
 * Starts an http server with the given options and attaches a websocket server
 * to it.
 *
 * @class Server
 * @param {object} options
 */

function WSServer(options) {
	this.sockets = [];
	this.queue = [];
	this.options = options;
	this.log = this.logger(options.verbose, 'WS');
	this.debug = this.logger(options.debug, 'WS');
	this.message = options.message || function() {};
	this.parent = options.parent;
	this.port = options.port || 8888;

	this.hostname = null;
	this.pageUrl = null;
	this.httpServer = http.createServer(function(req, res) {
		res.writeHead(404);
		res.end();
	});

	this.wsServer = new WSS({
		httpServer: this.httpServer,
		autoAcceptsockets: false
	});
	this.wsServer.on('request', this.onRequest.bind(this));
	this.httpServer.on('listening', this.onReady.bind(this));
}

WSServer.prototype.__proto__ = EventEmitter.prototype;

WSServer.prototype.onClose = function() {
	this.log("Closing...");
	this.sockets.forEach(function(socket) {
		return socket.destroy();
	});
};

WSServer.prototype.onReady = function() {
	this.parent.emit('ready');
	this.log('websocket listening port ' + this.options.port);
};
/**
 * Start Websocket Server.
 *
 * @private
 */
WSServer.prototype.start = function() {
	this.httpServer.listen(this.port, function(err) {
		if (err) {
			return this.log("Error : " + err);
		}
	}.bind(this));
};

/**
 * Request handler.
 *
 * @param {object} req
 * @private
 */

WSServer.prototype.onRequest = function(req) {
	this.log('Client connected', req.socket.address());
	var ws = req.accept();
	this.sockets.push(ws);
	ws.on('message', this.onMessage.bind(this));
	ws.on('close', this.onClose.bind(this, ws));

	this.broadcast({
		action: 'baseUrl'
	});
};

/**
 * Websocket socket close handler.
 *
 * @param {object} ws
 * @private
 */

WSServer.prototype.onMessage = function(message) {
	var buffer = new Buffer(message.utf8Data, 'base64').toString(message.type);
	var data  = JSON.parse(buffer);
	this.log('Message from the client :', data.action, data.url);

	//  this.log('Message from the client :', data);
	if (data.action == 'baseUrl') {
		var url = data.url.split('/');
		this.hostname = url.slice(0, 3).join('/') + '/';
		this.pageUrl = url.slice(3).join('/');
		this.debug('Client Url :', this.pageUrl);
		this.debug('Client Hostname :', this.hostname);
	}else {
		this.parent.onMessage(data);
	}
};

/**
 * Websocket socket close handler.
 *
 * @param {object} ws
 * @private
 */

WSServer.prototype.onClose = function(ws) {
	this.log('Client disconnected');
	if (this.sockets) {
		this.sockets.splice(this.sockets.indexOf(ws), 1);
	}
};

/**
 * Broadcast a message to the Client.
 *
 * @param {object} msg
 * @public
 */

WSServer.prototype.broadcast = function(msg) {
	if (msg.resourceURL !== undefined) {
		if (msg.resourceURL[0] == '/') {
			msg.resourceURL = msg.resourceURL.substr(1);
		}

		var hostname = this.hostname;
		if (msg.hostname !== undefined) {
			hostname = msg.hostname;
		}

		if (hostname[hostname.length - 1] == '/') {
			hostname = hostname.substr(0, hostname.length - 1);
		}

		msg.resourceURL = hostname + '/' + msg.resourceURL;

		this.debug('broadcast', msg.resourceURL);
	}

	this.sendMessage(msg);
};

/**
 * Broadcast a message to the Client.
 *
 * @param {object} msg
 * @private
 */

WSServer.prototype.sendMessage = function(msg) {

	this.debug('sendMessage', msg);
	if (msg.content !== undefined && msg.content.length >= 50000) {
		//send message by part
		var content = msg.content;
		delete msg.content;
		msg.part = content.substr(0, 50000);
		this.push(JSON.stringify(msg));
		delete msg.part;
		msg.content = content.substr(50000);
		this.sendMessage(msg);
	}else {
		// send full message
		this.push(JSON.stringify(msg));
	}
};

WSServer.prototype.push = function(data) {
	this.queue.push(data);
	this.pop();
};

WSServer.prototype.pop = function(data) {
	var data = this.queue.pop();
	if (data !== undefined) {
		this.sockets.forEach(function(ws) {
			ws.send(data);
		});
	}else if (this.queue.length > 0) {
		this.pop();
	}
};

/**
 * Close the server.
 *
 * @public
 */

WSServer.prototype.close = function() {
	this.debug('shutting down...');
	this.sockets = null;
	this.wsServer.shutDown();
	this.httpServer.close();
};

WSServer.prototype.logger = function(verbose, moduleName) {
	var slice = [].slice;
	return function() {
		var args = slice.call(arguments);
		args[0] = '[' + moduleName + '] ' + args[0];
		if (verbose) {
			console.log.apply(console, args);
		}
	}
};
