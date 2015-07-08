

var path = require('path');
var utf8 = require('utf8');
var fs = require('fs');

var through      =  require('through');
var combineSourceMap = require('combine-source-map');

function HandlebarsResolver(options) {
	this.index = [] ;
	if(options.module !== undefined){
		this.handlebars = options.module;
	}else{
		this.handlebars = require('handlebars');
	}
	this.reload = options.reload || true;
	this.loadMap(options.map);
}

HandlebarsResolver.prototype.hbsfy = function(originalFileContent) {
  var js = this.handlebars.precompile(originalFileContent.toString('utf8'));
  var compiled = "var Handlebars = require('hbsfy/runtime');\n";
	compiled += "module.exports = Handlebars.template(" + js.toString() + ");\n";
  return compiled;
};


HandlebarsResolver.prototype.createSourceMap = function(fileUrl, content) {
  var sourcemap = combineSourceMap.create();
  sourcemap.addFile(
    { sourceFile: fileUrl, source: utf8.encode(content) },
    { line: 1 }
  );
  var comment = sourcemap.comment();
  return new Buffer('\n' + comment + '\n').toString();
};


HandlebarsResolver.prototype.getHandlebarsFileContent = function(originalFilePath, fileUrl, originalFileContent) {

	var content = this.hbsfy(originalFileContent);
	var sourceMapInline = this.createSourceMap(fileUrl, content);
	var fileContent = this.index[originalFilePath].line +
	      '\n' + content + '\n' +
	'}';
		
	return {
		  content: fileContent,
		  sourcemap: sourceMapInline
		};
 
};

HandlebarsResolver.prototype.loadMap = function(mapFilePath) {
	var srcIndex = require(path.resolve(mapFilePath));
	for (var i in srcIndex) {
	  this.index[srcIndex[i].index] = {
	    src: srcIndex[i].src,
	    line: srcIndex[i].line
	  };
	}
};

HandlebarsResolver.prototype.resolve = function(originalFilePath, fileUrl, server, errorHandler) {
		
		var handlebarsFilePath = server.dest +'/' + this.index[originalFilePath].src;

    var record = {
      action: 'update',
      reload : this.reload,
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

   	var handlebarsFile = this.getHandlebarsFileContent(originalFilePath,'/' + fileUrl,originalFileContent);

			record.content = handlebarsFile.content + handlebarsFile.sourcemap;

	    fs.writeFile(handlebarsFilePath, record.content, function(err) {
	      if (err) { throw err;}
	      server.broadcast(record);
	    });

};



module.exports = HandlebarsResolver;