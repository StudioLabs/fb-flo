'use strict';

var path = require('path');
var utf8 = require('utf8');
var fs = require('fs');
var combineSourceMap = require('combine-source-map');

function BrowserifyResolver(options) {
	this.index = [] ;
	this.loadMap(options.map);
}

BrowserifyResolver.prototype.createSourceMap = function(fileUrl, content) {
  var sourcemap = combineSourceMap.create();
  sourcemap.addFile(
    { sourceFile: fileUrl, source: utf8.encode(content) },
    { line: 1 }
  );
  var comment = sourcemap.comment();
  return new Buffer('\n' + comment + '\n').toString();
};


BrowserifyResolver.prototype.getBrowserifyFileContent = function(originalFilePath, fileUrl, content, errorHandler) {
  var sourceMapInline = this.createSourceMap(fileUrl, content);
  var fileContent = this.index[originalFilePath].line +
      '\n' + content + '\n' +
  '}';

  return {
    content:fileContent,
    sourcemap:sourceMapInline
  };
};



BrowserifyResolver.prototype.loadMap = function(mapFilePath) {
	var srcIndex = require(path.resolve(mapFilePath));
	for (var i in srcIndex) {
	  this.index[srcIndex[i].index] = {
	    src: srcIndex[i].src,
	    line: srcIndex[i].line
	  };
	}
};

BrowserifyResolver.prototype.resolve = function(originalFilePath, fileUrl, server) {
		
		var browserifyFilePath = server.dest +'/' + this.index[originalFilePath].src;

    var record = {
      action: 'update',
      resourceURL: server.getClientPageUrl()+this.index[originalFilePath].src
    };

    var originalFileContent = '';

    if (this.index[originalFilePath].content === undefined) {
      originalFileContent = utf8.encode(fs.readFileSync(originalFilePath).toString());
      record.sync = server.getClientHostname() + '/' + fileUrl;
    }else {
      originalFileContent = this.index[originalFilePath].content;
      delete this.index[originalFilePath].content;
      record.resourceName = server.getClientHostname() + '/'  + fileUrl;
    }

    this.index[originalFilePath].sync = originalFileContent;

    var browserifyFile = this.getBrowserifyFileContent(
                                        originalFilePath,
                                        '/' + fileUrl,
                                        originalFileContent);

    record.content = browserifyFile.content + browserifyFile.sourcemap;

    fs.writeFile(browserifyFilePath, record.content, function(err) {
      if (err) { throw err;}
      server.broadcast(record);
    });

};



module.exports = BrowserifyResolver;