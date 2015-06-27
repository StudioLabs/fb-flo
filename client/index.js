/**
 *  Copyright (c) 2014, StudioLabs, Inc.
 *  All rights reserved.
 *
 *  This source code is licensed under the BSD-style license found in the
 *  LICENSE file in the root directory of this source tree. An additional grant
 *  of patent rights can be found in the PATENTS file in the same directory.
 */

/*global Session:false, chrome:true */
/* jshint evil:true */

(function() {
  'use strict';

  /**
   * Constants
   */

  var LIVE_EDIT_CONFIG_KEY = 'live-edit-config';

  /**
   * LiveEdit client controller.
   *
   * @class LiveEditClient
   * @private
   */

  function LiveEditClient() {
    var self = this;
    loadConfig(function (config) {
      self.config = config;
      self.session = null;
      self.panelWindow = null;
      self.panelEventBuffer = [];
      self.status = self.status.bind(self);
      self.startNewSession = self.startNewSession.bind(self);
      self.createLogger = Logger(self.triggerEvent.bind(self, 'log'));
      self.logger = self.createLogger('live-edit');
      self.createPanel();
      self.start();
    });
  }

  /**
   * Save current config to disk.
   *
   * @param {object} config
   * @private
   */

  LiveEditClient.prototype.saveConfig = function() {
    saveConfig(this.config);
  };

  /**
   * Listen on the panel window for an event `type`, i.e. receive a message
   * from the panel.
   *
   * @param {string} type
   * @param {function} callback
   * @private
   */

  LiveEditClient.prototype.listenToPanel = function(type, callback) {
    if (!this.panelWindow) {
      throw new Error('Panel not found');
    }
    this.panelWindow.addEventListener('live_edit_' + type, callback.bind(this));
  };

  /**
   * Trigger an event on the panel window, i.e. send a message to the panel.
   * If the panel wasn't instantiated yet, the event is buffered.
   *
   * @param {string} type
   * @param {object} data
   * @private
   */

  LiveEditClient.prototype.triggerEvent = function(type, data) {
    var event = new Event('live_edit_' + type);
    event.data = data;
    // Save events for anytime we need to reinit the panel with prev state.
    this.panelEventBuffer.push(event);
    if (this.panelWindow) {
      this.panelWindow.dispatchEvent(event);
    }
    return event;
  };

  /**
   * Create a new panel.
   *
   * @param {function} callback
   * @private
   */

  LiveEditClient.prototype.createPanel = function(callback) {
    var self = this;
    chrome.devtools.panels.create(
      'LiveEdit',
      '',
      'configure/configure.html',
      function (panel) {
        panel.onShown.addListener(function(panelWindow) {
          if (!panelWindow.wasShown) {
            self.panelWindow = panelWindow;
            self.initPanel();
            panelWindow.wasShown = true;
          }
        });
      }
    );
  };

  /**
   * Called after the panel is first created to listen on it's events.
   * Will also trigger all buffered events on the panel.
   *
   * @param {object} config
   * @private
   */

  LiveEditClient.prototype.initPanel = function() {
    this.listenToPanel('config_changed', function(e) {
      this.config = e.data;
      this.saveConfig();
      this.startNewSession();
    });
    this.listenToPanel('save_force_reload', function(e) {
      this.site.forceReloading= e.data;
      this.session.setForceReloading(this.site.forceReloading);
      this.saveConfig();
    });
    this.listenToPanel('retry', this.startNewSession);
    this.listenToPanel('enable_for_host', this.enableForHost);
    this.panelEventBuffer.forEach(function(event) {
      this.panelWindow.dispatchEvent(event);
    }, this);
    this.triggerEvent('load', this.config);
  };

  /**
   * Starts the LiveEdit client.
   *
   * @private
   */

  LiveEditClient.prototype.start = function() {
    this.status('starting');
    this.startNewSession();
  };


  /**
   * Stops LiveEdit client.
   *
   * @private
   */

  LiveEditClient.prototype.stop = function() {
    this.session.destroy();
    this.session = null;
  };

  /**
   * Get the url location of the inspected window.
   *
   * @param {function} callback
   * @private
   */

  LiveEditClient.prototype.getLocation = function(callback) {
    chrome.devtools.inspectedWindow['eval'](
      'location.hostname || location.href',
      callback.bind(this)
    );
  };

  /**
   * Match config patterns against `host` and returns the matched site record.
   *
   * @param {string} host
   * @return {object|null}
   * @private
   */

  LiveEditClient.prototype.getSite = function(host) {
    var config = this.config;
    for (var i = 0; i < config.sites.length; i++) {
      var site = config.sites[i];
      var pattern = parsePattern(site.pattern);
      var matched = false;
      if (pattern instanceof RegExp) {
        matched = pattern.exec(host);
      } else {
        matched = pattern === host;
      }
      if (matched) return site;
    }
    return null;
  };

  /**
   * Instantiates a new `session`.
   *
   * @private
   */

  LiveEditClient.prototype.startNewSession = function() {
    if (this.session) {
      this.stop();
    }

    this.getLocation(
      function (host) {
        var site = this.getSite(host);
        this.site = site;

        if (site) {
          this.session = new Session(
            site.server || host,
            site.port || this.config.port,
            this.status,
            this.createLogger
          );
          this.session.start();
          if(this.site.forceReloading !== undefined){
            this.session.setForceReloading(this.site.forceReloading);
          }
        } else {
          this.status('disabled');
        }
      }
    );
  };

  /**
   * Enables LiveEdit for the current inspected window host.
   *
   * @private
   */

  LiveEditClient.prototype.enableForHost = function() {
    this.getLocation(function(host) {
      if (!this.getSite(host)) {
        this.config.sites.push({
          pattern: host,
          server: host
        });
        this.saveConfig();
        this.triggerEvent('load', this.config);
        this.startNewSession();
      }
    });
  };

  /**
   * Reports status changes to panel.
   *
   * @param {string} status
   * @param {object} aux
   * @private
   */

  LiveEditClient.prototype.status = function(status, aux) {
    var text, action;
    switch (status) {
      case 'starting':
        text = 'Starting';
        break;
      case 'disabled':
        text = 'Disabled for this site';
        action = 'enable';
        break;
      case 'connecting':
        text = 'Connecting';
        break;
      case 'connected':
        text = 'Connected';
        if(this.site.forceReloading !== undefined){
          this.triggerEvent('force_reload', this.site.forceReloading );
        }else{
          this.triggerEvent('force_reload', 'disable' );
        }
        break;
      case 'started':
        text = 'Started';
        break;
      case 'retry':
        text = 'Failed to connect, retrying in ' + (aux / 1000) + 's';
        break;
      case 'error':
        text = 'Error connecting';
        action = 'retry';
        break;
      default:
        throw new Error('Unknown session status.');
    }

    this.triggerEvent('status_change', {
      type: status,
      text: text,
      action: action
    });
  };

  /**
   * Save passed in config object to disk.
   *
   * @param {object} config
   * @private
   */

  function saveConfig(config) {
    chrome.runtime.sendMessage({
      name: 'localStorage:set',
      key: LIVE_EDIT_CONFIG_KEY,
      data: JSON.stringify(config)
    });
  }

  /**
   * Loads config from storage.
   *
   * @param {function} done
   * @private
   */

  function loadConfig(done) {
    var configJSON = tryToLoadLegacyConfig();

    if (configJSON) {
      var config = parseConfig(configJSON);
      // Persist new config to the new storage.
      saveConfig(config);
      setTimeout(done.bind(null, config), 0);
    }
    else {
      chrome.runtime.sendMessage(
        {
          name : 'localStorage:get',
          key : LIVE_EDIT_CONFIG_KEY
        },
        function (configJSON){
          var config = parseConfig(configJSON);
          done(config);
        }
      );
    }
  }

  /**
   * Parses config and sets sensible defaults.
   *
   * @param {string} config
   * @param {}
   * @private
   */

  function parseConfig(configJSON) {
    var config;

    try {
      config = JSON.parse(configJSON);
    }
    catch (ex) {
      config = {};
    }

    config.sites = config.sites || [];
    config.port = config.port || 8888;

    return config;
  }

  /**
   * Tries to load config from localstorage which was the old way of storing
   * config and returns false if it fails.
   *
   * @return {string} config
   * @private
   */

  function tryToLoadLegacyConfig() {
    var config = null;

    try {
      config = window.localStorage && localStorage.getItem(LIVE_EDIT_CONFIG_KEY);
      if (config) {
        localStorage.removeItem(LIVE_EDIT_CONFIG_KEY);
      }
    } catch (e) {
      return false;
    }

    return config;
  }

  /**
   * Optionally parses config from JSON to an object.
   * Also, parses patterns into regexp.
   *
   * @private
   * @return {object}
   */

  function parsePattern(pattern) {
    if (!pattern) return null;
    var m = pattern.match(/^\/(.+)\/([gim]{0,3})$/);
    if (m && m[1]) {
      return new RegExp(m[1], m[2]);
    }
    return pattern;
  }

  // Start the app.
  new LiveEditClient();

})();
