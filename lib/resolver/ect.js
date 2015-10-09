

var path = require('path');
var utf8 = require('utf8');
var fs = require('fs');

var through      =  require('through');

function ECTResolver(options) {
	this.index = [] ;

	options = options || {};

	if (options.module !== undefined) {
		this.ect = options.module;
	}else {
		this.ect = require('ect');
	}

	if (!options.ext) options.ext = '.ect';
	if (options.data === undefined) options.data = {};
	if (!options.outExt) options.outExt = '.html';

	this.reload = options.reload || false;

	this.options = options;

}

ECTResolver.prototype.getECTFileContent = function(file) {

	var renderer = this.ect({
		root: file.dir
	 });

	return renderer.render(file.base, this.options.data);
}

ECTResolver.prototype.resolve = function(originalFilePath, fileUrl, server, errorHandler) {

	var file  = path.parse(originalFilePath);
	var url = '/' + fileUrl.replace(file.ext, '.html');

	var record = {
		action: 'document',
		reload: this.reload,
		resourceURL: url
	};

	var originalFileContent = fs.readFileSync(originalFilePath);

	record.content = this.getECTFileContent(file);

	fs.writeFile(server.options.devtools.dest + url, record.content, function(err) {
		if (err) { throw err;}

		server.broadcast(record);
	});

};

module.exports = ECTResolver;
