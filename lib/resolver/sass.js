'use strict';

var path = require('path');
var fs = require('fs');

function SassResolver(options) {
  this.index = [] ;
  this.cmd = options.cmd;
  this.loadMap(options.map);
}


SassResolver.prototype.loadMap = function(mapFilePath) {
  var hrefIndex = require(path.resolve(mapFilePath));
  for (var i in hrefIndex) {
    this.index[hrefIndex[i].index] = {
      index: hrefIndex[i].links
    };
  }
};


SassResolver.prototype.resolve = function(originalFilePath, fileUrl, server, errorHandler) {
    var sync = true;
    var originalFileContent = '';
    if (this.index[originalFilePath].content === undefined) {
      originalFileContent = fs.readFileSync(originalFilePath).toString();
    } else {
      originalFileContent = this.index[originalFilePath].content;
      delete this.index[originalFilePath].content;
      sync = false;
    }

    this.index[originalFilePath].sync = originalFileContent;

    this.index[originalFilePath].index.forEach(function(sassfilePath) {
      this.cmd(sassfilePath, sassfilePath.replace(server.dest+'/', ''), function(url, content) {
       
        var record  = {
          action: 'update',
          resourceURL: server.getClientPageUrl()+url,
          content: content
        };

        if (sync) {
          record.sync = server.getClientHostname() + '/' + fileUrl;
        }else {
          record.resourceName = server.getClientHostname() + '/' + fileUrl;
        }

     

        server.broadcast(record);

      },errorHandler);

    }.bind(this));


};

module.exports = SassResolver;
