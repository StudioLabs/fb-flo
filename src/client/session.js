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
  "use strict";
  /**
	   * Export to Node for testing and to global for production.
	   */

  if (typeof module === "object" && typeof exports === "object") {
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
    this.logger = createLogger("session");
    this.devResources = [];
    this.url = null;
    this.conn = null;
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
    this.getLocation(this.setLocation);
  };

  /**
	   * Similar to restart but does only what's needed to get DevtoolsLive started.
	   *
	   * @public
	   */

  Session.prototype.restart = function() {
    if (this.logger) {
      this.logger.log("Restarting");
    }

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
    this.forceReloading = value == "enable" ? true : false;
  };

  /**
	   * Registers a resource.
	   *
	   * @param {function} res
	   * @private
	   */

  Session.prototype.registerResource = function(res) {
    // exclude ressource that are data
    //
    if (res.url.substr(0, 4) == "http") {
      var url = res.url.split("?")[0].replace(this.url, "");

      this.devResources[url] = res;
      if (this.loader !== undefined) {
        this.loader.urls = this.loader.urls.filter(function(e) {
          return url.indexOf(e) == -1;
        });

        if (this.loader.urls.length == 0) {
          var toSync = this.loader.toSync;
          delete this.loader;
        }

        if (toSync !== undefined) {
          this.conn.sendMessage({
            action: "sync",
            src: toSync
          });
        }
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
    } else {
      this.logger.log("erorr on location");
    }
  };

  /**
	   * Get the url location of the inspected window.
	   *
	   * @param {function} callback
	   * @private
	   */

  Session.prototype.getLocation = function(callback) {
    chrome.devtools.inspectedWindow["eval"](
      "location.origin+location.pathname",
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
    chrome.devtools.inspectedWindow.getResources(
      function(resources) {
        resources.forEach(
          function(res) {
            this.registerResource(res);
          }.bind(this)
        );

        // After we register the current resources, we listen to the
        // onResourceAdded event to push on more resources lazily fetched
        // to our array.
        chrome.devtools.inspectedWindow.onResourceAdded.addListener(
          function(res) {
            this.registerResource(res);
          }.bind(this)
        );

        if (callback !== undefined) {
          this.console(" ", "Ready !");

          callback();
        }
      }.bind(this)
    );
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
        self.status("error");
      })
      .onopen(function() {
        self.status("connected");
        callback();
      })
      .onretry(function(delay) {
        self.status("retry", delay);
      })
      .onconnecting(function() {
        self.status("connecting");
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
    this.status("started");

    chrome.devtools.network.onNavigated.addListener(this.restart);
    chrome.devtools.inspectedWindow.onResourceContentCommitted.addListener(
      this.resourceUpdatedHandler.bind(this)
    );
  };

  /**
	   * Handle Resource Updated.
	   *
	   * @param {object} updatedResource
	   * @param {string} content
	   * @private
	   */
  Session.prototype.resourceUpdatedHandler = function(
    updatedResource,
    content
  ) {
    if (updatedResource.registered == undefined) {
      var src = updatedResource.url.split("?")[0].replace(this.url, "");

      if (this.devResources[src] !== undefined) {
        var resource = this.devResources[src];

        if (resource.resourceName !== undefined) {
          this.triggerUpdateEvent(resource.resourceName);
        } else if (resource.sync !== undefined) {
          var sync = resource.sync;
          var record = {
            action: "sync",
            src: sync.replace(this.url, "")
          };
          this.conn.sendMessage(record);
          delete resource.sync;
        } else {
          if (src !== "") {
            this.conn.sendMessage({
              action: "update",
              src: src,
              content: content
            });
          } else {
            this.index();
          }
        }
      }

      updatedResource.registered = true;
    }
  };

  /***
	* Update browser resouce.
    * @param { object }	resource
    */

  Session.prototype.updateResource = function(resource, update) {
    console.log("updateResource", resource, update);

    var setContent = function() {
      var content = decodeURIComponent(
        escape(
          window.atob(window.btoa(unescape(encodeURIComponent(update.content))))
        )
      );
      var url = decodeURIComponent(
        escape(
          window.atob(window.btoa(unescape(encodeURIComponent(resource.url))))
        )
      );

      var script = "(function() {" +
        "var content = " +
        content +
        " ;" +
        "var url = " +
        url +
        " ;" +
        "var uiSourceCode = WebInspector.workspace.uiSourceCodeForOriginURL(content);" +
        "uiSourceCode.setWorkingCopy(url);" +
        "}" +
        "})()";

      chrome.devtools.inspectedWindow.eval(script);

      resource.setContent(
        update.content,
        true,
        function(status) {
          if (status.code != "OK") {
            this.logger.error(
              "devtoolsLive failed to update, this shouldn't happen please report it: " +
                JSON.stringify(status)
            );
          } else {
            this.triggerEvent(update.event, {});

            if (resource.resourceName !== undefined) {
              delete resource.resourceName;
            }

            if (resource.update !== undefined) {
              this.messageHandler(resource.update);
              delete resource.update;
            }
          }
        }.bind(this)
      );
    }.bind(this);

    setContent();

    // if (!this.openedSources[update.url]) {
    // 	chrome.devtools.panels.openResource(resource.url, null, function() {
    // 		// doesn't always work right away
    // 		this.openedSources[update.url] = true;
    // 		setTimeout(setContent, 100);
    // 	}.bind(this));
    // } else {

    // }
  };

  /***
	* Handler for messages from the server.
    * @param { object }	message
    */

  Session.prototype.messageHandler = function(message) {
    console.log("messageHandler", message);

    if (message.action == "baseUrl" && this.conn && this.url) {
      return this.conn.sendMessage({
        action: "baseUrl",
        url: this.url
      });
    } else if (this.forceReloading === true || message.action == "reload") {
      this.reload();
      return;
    } else if (message.action == "urls") {
      if (message.next != undefined) {
        if (this.devResources[message.next.url] !== undefined) {
          this.loader = this.devResources[message.next.url];
          this.loader.toSync = message.next.url;
          this.loader.update = message.next.update;
          if (message.data !== undefined) {
            this.loader.urls = message.data.urls;
          }
        }
      }

      if (message.data !== undefined) {
        this.addFiles(message.data.html);
      }

      return;
    } else if (message.action == "error") {
      if (this.devResources[message.src] !== undefined) {
        var resource = this.devResources[message.src];
        this.updateResource(resource, message);
      }

      this.error(message.url, message);
    } else if (message.action == "sync") {
      this.logger.log("sync", message.url);

      if (this.devResources[message.url] !== undefined) {
        var resource = this.devResources[message.url];
        resource.resourceName = message.url;
      }
    } else if (message.action == "update") {
      this.logger.log("push", message.url);

      if (message.reload === true) {
        chrome.devtools.inspectedWindow.reload({ ignoreCache: true });
        return;
      }

      if (message.url.indexOf("index.html") >= 0) {
        message.url = "";
      }

      if (this.devResources[message.url] !== undefined) {
        var resource = this.devResources[message.url];
      }
    }

    if (resource === undefined) {
      this.logger.error(
        "Resource with the following URL is not on the page:",
        message.url
      );
      return;
    }

    if (message.resourceName !== undefined) {
      resource.resourceName = message.resourceName;
    }

    if (message.sync !== undefined) {
      resource.sync = message.sync;
    }

    if (message.part !== undefined) {
      if (resource.part === undefined) {
        resource.part = [];
      }

      // store each part
      resource.part.push(message.part);
    } else {
      // concat all parts
      if (resource.part !== undefined) {
        resource.part.push(message.content);
        message.content = resource.part.join("");
        delete resource.part;
      }

      this.updateResource(resource, message);
    }
  };

  /**
	   * Destroys session.
	   *
	   * @public
	   */

  Session.prototype.destroy = function() {
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
    var dataB64 = window.btoa(
      unescape(encodeURIComponent(JSON.stringify(data)))
    );
    var data = decodeURIComponent(escape(window.atob(dataB64)));
    var script = "(function() {" +
      "var data = " +
      data +
      " ;" +
      "console.warn(data.message);" +
      "})()";

    chrome.devtools.inspectedWindow.eval(script);
  };

  Session.prototype.addFiles = function(html) {
    var dataB64 = window.btoa(
      unescape(encodeURIComponent(JSON.stringify(html)))
    );
    var data = decodeURIComponent(escape(window.atob(dataB64)));

    var script = "(function() {" +
      "var html = " +
      data +
      " ;" +
      "for (var i in html){" +
      "var data = html[i] ;" +
      "var el = document.createElement(data.tag);" +
      "for(var y in data.attributes){" +
      "	el.setAttribute(y,data.attributes[y]);" +
      "}" +
      'console.log("[Live][add]", el);' +
      "document.body.appendChild(el);" +
      "}" +
      "})()";

    chrome.devtools.inspectedWindow.eval(script);
  };

  Session.prototype.console = function(title, data) {
    var dataB64 = window.btoa(
      unescape(encodeURIComponent(JSON.stringify(data)))
    );
    var data = decodeURIComponent(escape(window.atob(dataB64)));
    var script = "(function() {" +
      "var data = " +
      data +
      " ;" +
      'console.log("[Live] ' +
      title +
      '",data);' +
      "})()";

    chrome.devtools.inspectedWindow.eval(script);
  };

  Session.prototype.reload = function(url) {
    var script = "(function() {" +
      "window.addEventListener('devtools-live-reload',function(){" +
      'console.log("[reload] reloading the page...");' +
      "}); " +
      "})()";

    this.triggerEvent("devtools-live-reload", {});

    chrome.devtools.inspectedWindow.eval(script);

    chrome.devtools.inspectedWindow.reload({ ignoreCache: true });
  };

  Session.prototype.index = function(html) {
    this.reload();
  };

  Session.prototype.addRessource = function(url, contentScript) {
    if (typeof url == "string") {
      var script = "(function() {" +
        'console.log("[add] ' +
        this.url +
        url +
        ' has just been updated ["+ time +"] ");' +
        contentScript +
        "})()";

      chrome.devtools.inspectedWindow.eval(script);
    }
  };

  Session.prototype.triggerEvent = function(event, data) {
    var dataB64 = window.btoa(
      unescape(encodeURIComponent(JSON.stringify(data)))
    );
    var data = decodeURIComponent(escape(window.atob(dataB64)));

    var script = "(function() {" +
      "var event = new Event('" +
      event +
      "');" +
      "event.data = " +
      data +
      " ;" +
      "window.dispatchEvent(event);" +
      "})()";

    chrome.devtools.inspectedWindow.eval(script);
  };

  Session.prototype.triggerUpdateEvent = function(url) {
    if (typeof url == "string") {
      var duration = new Date();

      var script = "(function() {" +
        "var liveEvent = new Event('fileUpdate');" +
        "liveEvent.data = '" +
        url +
        "' ;" +
        "window.dispatchEvent(liveEvent);" +
        'console.log(" => ' +
        this.url +
        url +
        " [" +
        duration.getTime().toString() +
        ']");' +
        "})()";

      chrome.devtools.inspectedWindow.eval(script);
    }
  };
}.call(this));
