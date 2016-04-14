/**
 *  Copyright (c) 2014, StudioLabs, Inc.
 *  All rights reserved.
 *
 *  This source code is licensed under the BSD-style license found in the
 *  LICENSE file in the root directory of this source tree. An additional grant
 *  of patent rights can be found in the PATENTS file in the same directory.
 */

/*global Connection:false */

(function() {
	'use strict';

	/**
	   * Export to Node for testing and to global for production.
	   */

	if (typeof module === 'object' && typeof exports === 'object') {
		module.exports = Session;
	} else {
		this.Session = Session;
	}

	/**
	   * Manages a user sessios.
	   *
	   * @param {string} host
	   * @param {number} port
	   * @param {function} status
	   * @param {function} logger
	   * @class Session
	   * @public
	   */

	function Session(host, port, status, createLogger) {
		this.host = host;
		this.port = port;
		this.status = status;
		this.createLogger = createLogger;
		this.logger = createLogger('session');
		this.devResources = [];
		this.openedSources = {};
		this.url = null;
		this.conn = null;
		this.listeners = {};
		this.forceReloading = false;
		this.messageHandler = this.messageHandler.bind(this);
		this.started = this.started.bind(this);
	}

	/**
	   * Registers the resources, connects to server and listens to events.
	   *
	   * @public
	   */

	Session.prototype.start = function() {
		this.logger.log('Starting DevtoolsLive for host', this.host);
		this.getLocation(this.setLocation);
	};

	/**
	   * Similar to restart but does only what's needed to get DevtoolsLive started.
	   *
	   * @public
	   */

	Session.prototype.restart = function() {
		this.logger.log('Restarting');
		this.removeEventListeners();
		if (this.conn.connected()) {
			// No need to reconnect. We just refetch the resources.
			this.getResources(this.started.bind(this));
		} else {
			this.start();
		}
	};

	/**
	   * Force the reloading of the page
	   *
	   * @public
	   */

	Session.prototype.setForceReloading = function(value) {
		this.forceReloading = (value == 'enable') ? true : false;
	};

	/**
	   * This method takes care of listening to events defined by the chrome api
	   * @see http://developer.chrome.com/extensions/events
	   * We also keep an internal map of events we're listening to so we can
	   * unsubscribe in the future.
	   *
	   * @param {object} object
	   * @param {string} event
	   * @param {function} listener
	   * @private
	   */

	Session.prototype.listen = function(obj, event, listener) {
		listener = listener.bind(this);
		obj[event].addListener(listener);
		this.listeners[event] = {
			obj: obj,
			listener: listener
		};
	};

	/**
	   * Remove all event listeners.
	   *
	   * @private
	   */

	Session.prototype.removeEventListeners = function() {
		Object.keys(this.listeners).forEach(function(event) {
			var desc = this.listeners[event];
			desc.obj[event].removeListener(desc.listener);
		}, this);
	};

	/**
	   * Registers a resource.
	   *
	   * @param {function} res
	   * @private
	   */

	Session.prototype.registerResource = function(res) {
		// exclude ressource that are data

		if (res.url.substr(0, 4) == 'http') {
			var url = res.url.split('?')[0];
			if (url !== '') {
				this.devResources[url] = res;
			}
		}

	};

	/**
	   * save the url location then start getting resources.
	   *
	   * @param {function} callback
	   * @private
	   */

	Session.prototype.setLocation = function(url) {
		if (url) {
			this.url = url;
			this.getResources(this.connect.bind(this, this.started));
		}else {
			this.logger.log('erorr on location');
		}
	};

	/**
	   * Get the url location of the inspected window.
	   *
	   * @param {function} callback
	   * @private
	   */

	Session.prototype.getLocation = function(callback) {
		chrome.devtools.inspectedWindow['eval'](
		'location.origin+location.pathname',
		callback.bind(this)
		);
	};

	/**
	   * Registers the resources and listens to onResourceAdded events.
	   *
	   * @param {function} callback
	   * @private
	   */

	Session.prototype.getResources = function(callback) {

		chrome.devtools.inspectedWindow.getResources(function(resources) {

			resources.forEach(function(res) {
				this.registerResource(res);
			}.bind(this));


			// After we register the current resources, we listen to the
			// onResourceAdded event to push on more resources lazily fetched
			// to our array.
			this.listen(
			chrome.devtools.inspectedWindow,
			'onResourceAdded',
        function(res) {
	this.registerResource(res);
        }.bind(this)
      );


			console.log('ressource', this.devResources);

			this.console(' ', 'Ready !');
			callback();
		}.bind(this));
	};

	/**
	   * Connect to server.
	   *
	   * @param {function} callback
	   * @private
	   */

	Session.prototype.connect = function(callback) {

		callback = once(callback);
		var self = this;
		this.conn = new Connection(this.host, this.port, this.createLogger)
		.onmessage(this.messageHandler)
      .onerror(function() {
	self.status('error');
      })
      .onopen(function() {
	self.status('connected');
	callback();
      })
      .onretry(function(delay) {
	self.status('retry', delay);
      })
      .onconnecting(function() {
	self.status('connecting');
      })
      .connect();

	};

	/**
	   * Does whatever needs to be done after the session is started. Currenlty
	   * just listening to page refresh events.
	   *
	   * @param {function} callback
	   */

	Session.prototype.started = function() {
		this.logger.log('Started');
		this.status('started');
	/*	if (this.conn && this.url) {
			this.conn.sendMessage({
				action: 'baseUrl',
				url: this.url
			});
		}
*/
		this.listen(
		chrome.devtools.network,
		'onNavigated',
		this.restart
		);
		this.listen(
		chrome.devtools.inspectedWindow,
		'onResourceContentCommitted',
		this.resourceUpdatedHandler
		);
	};

	/**
	   * Handle Resource Updated.
	   *
	   * @param {object} updatedResource
	   * @param {string} content
	   * @private
	   */
	Session.prototype.resourceUpdatedHandler = function(updatedResource, content) {

		var src = updatedResource.url.split('?')[0];
		if (src !== '' && this.devResources[src] !== undefined) {
			var resource = this.devResources[src];

			if (resource.resourceName !== undefined) {

				this.triggerUpdateEvent(resource.resourceName);

			}else if (resource.sync !== undefined) {
					var sync = resource.sync;
					var record = {
						action: 'sync',
						src: sync
					};
					this.conn.sendMessage(record);
					delete resource.sync;
			} else{
				this.conn.sendMessage({
					action: 'update',
					src: src,
					content: content
				});
			}

		}

	};


	/***
	* Update browser resouce.
    * @param { object }	resource
    */

	 Session.prototype.updateResource = function(resource, update) {
	 	console.log('updateResource',resource, update);

		var setContent = function() {
			resource.setContent(update.content, true, function(status) {
				if (status.code != 'OK') {
					this.logger.error(
					'devtoolsLive failed to update, this shouldn\'t happen please report it: ' +
					JSON.stringify(status)
					);
				}else {
					if (update.event !== undefined) {
						if (resource.resourceName !== undefined && !this.openedSources[resource.resourceName]) {
							chrome.devtools.panels.openResource(resource.resourceName, null, function() {
								this.openedSources[resource.resourceName] = true;
								this.triggerEvent(update.event, {});
							}.bind(this));
						}else{
							this.triggerEvent(update.event, {});
						}
					}
					if (resource.resourceName !== undefined) {
						delete resource.resourceName;
					}
				}
			}.bind(this));
		}.bind(this);

		if (!this.openedSources[update.url]) {
			chrome.devtools.panels.openResource(resource.url, null, function() {
				// doesn't always work right away
				this.openedSources[update.url] = true;
				setTimeout(setContent, 100);
			}.bind(this));
		} else {
			setContent();
		}


	};


	/***
	* Handler for messages from the server.
    * @param { object }	updatedResource
    */

	Session.prototype.messageHandler = function(updatedResource) {

		if (updatedResource.action == 'baseUrl' && this.conn && this.url) {
			return this.conn.sendMessage({
				action: 'baseUrl',
				url: this.url
			});
		}else if (this.forceReloading === true) {
			this.reload();
			return;
		}else if (updatedResource.action == 'document') {
			this.document(updatedResource.content);
			return;
		}else if (updatedResource.action == 'error') {

			if (this.devResources[updatedResource.url] !== undefined) {
				var resource = this.devResources[updatedResource.url];
				this.updateResource(resource, updatedResource);
			}

			this.error(updatedResource.url, updatedResource);

		}else if (updatedResource.action == 'sync') {

			this.logger.log('sync', updatedResource.url);

			if (this.devResources[updatedResource.url] !== undefined) {
				var resource = this.devResources[updatedResource.url];
				resource.resourceName = updatedResource.url;
			}

		}else if (updatedResource.action == 'update') {

			this.logger.log('push', updatedResource.url);

			if (updatedResource.reload === true) {
				chrome.devtools.inspectedWindow.reload({ignoreCache: true});
				return;
			}

			if (updatedResource.url.indexOf('index.html') > 0) {
				updatedResource.url = updatedResource.url.replace('index.html', '');
			}

			if (this.devResources[updatedResource.url] !== undefined) {
				var resource = this.devResources[updatedResource.url];
			}


			if (updatedResource.resourceName !== undefined) {
				resource.resourceName = updatedResource.resourceName;
			}

		}

		if (resource === undefined) {
			this.logger.error(
			'Resource with the following URL is not on the page:',
			updatedResource.url
			);
			return;
		}


		if (updatedResource.sync !== undefined) {
			resource.sync = updatedResource.sync;
		}


		if (updatedResource.part !== undefined) {

			if (resource.part === undefined) {
				resource.part = [];
			}

			// store each part
			resource.part.push(updatedResource.part);

		}else {
			// concat all parts
			if (resource.part !== undefined) {
				resource.part.push(updatedResource.content);
				updatedResource.content = resource.part.join('');
				delete resource.part;
			}


			this.updateResource(resource,updatedResource);
		}

	};

	/**
	   * Destroys session.
	   *
	   * @public
	   */

	Session.prototype.destroy = function() {
		this.removeEventListeners();
		if (this.conn) this.conn.disconnect();
	};

	/**
	   * Utility to ensure's a function is called only once.
	   *
	   * @param {function} cb
	   * @private
	   */

	function once(cb) {
		var called = false;
		return function() {
			if (!called) {
				called = true;
				return cb.apply(this, arguments);
			}
		};
	}

	Session.prototype.error = function(title, data) {
		var dataB64 = window.btoa(unescape(encodeURIComponent(JSON.stringify(data))));
		var data = decodeURIComponent(escape(window.atob(dataB64)));
		var script = '(function() {' +
		'var data = ' + data + ' ;' +
		'console.warn(data.message);' +
		'})()';

		chrome.devtools.inspectedWindow.eval(script);
	}

	Session.prototype.document = function(html) {
		var dataB64 = window.btoa(unescape(encodeURIComponent(JSON.stringify({content: html}))));
		var data = decodeURIComponent(escape(window.atob(dataB64)));
		var script = '(function() {' +
		'var page = ' + data + ' ;' +
		'console.log("[document]", page);' +
		'document.documentElement.innerHTML = page.content;' +
		'})()';

		chrome.devtools.inspectedWindow.eval(script);
	}

	Session.prototype.console = function(title, data) {
		var dataB64 = window.btoa(unescape(encodeURIComponent(JSON.stringify(data))));
		var data = decodeURIComponent(escape(window.atob(dataB64)));
		var script = '(function() {' +
		'var data = ' + data + ' ;' +
		'console.log("[Live] ' + title + '",data);' +
		'})()';

		chrome.devtools.inspectedWindow.eval(script);
	}

	Session.prototype.triggerEvent = function(event, data) {
		var dataB64 = window.btoa(unescape(encodeURIComponent(JSON.stringify(data))));
		var data = decodeURIComponent(escape(window.atob(dataB64)));

		var script = '(function() {' +
		'var event = new Event(\'' + event + '\');' +
		'event.data = ' + data + ' ;' +
		'window.dispatchEvent(event);' +
		'})()';

		chrome.devtools.inspectedWindow.eval(script);
	};

	Session.prototype.reload = function(url) {

		var script = '(function() {' +
		'window.addEventListener(\'devtools-live-reload\',function(){' +
		'console.log("[reload] reloading the page...");' +
		'}); ' +
		'})()';

		this.triggerEvent('devtools-live-reload', {});

		chrome.devtools.inspectedWindow.eval(script);

		chrome.devtools.inspectedWindow.reload({ignoreCache: true});

	};

	Session.prototype.addRessource = function(url, contentScript) {

		if (typeof url == 'string') {
			var script = '(function() {' +
			'console.log("[add] ' + url + ' has just been updated ["+ time +"] ");' +
			 contentScript+
			'})()';

			chrome.devtools.inspectedWindow.eval(script);
			chrome.devtools.panels.openResource(url, null, function() {});
		}

	};

	Session.prototype.triggerUpdateEvent = function(url) {

		if (typeof url == 'string') {
			var script = '(function() {' +
			'var time = new Date().getTime();' +
			'console.log("[update] ' + url + ' has just been updated ["+ time +"] ");' +
			'})()';

			chrome.devtools.inspectedWindow.eval(script);
			chrome.devtools.panels.openResource(url, null, function() {});
		}

	};

}).call(this);
