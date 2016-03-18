/*
	MIT License http://www.opensource.org/licenses/mit-license.php
	Author Steed MONTEIRO @SteedMonteiro
*/
var path = require("path");
var fs = require("fs");
var MemoryFileSystem = require("memory-fs");
var mime = require("mime");
var parseUrl = require('parseurl');

// constructor for the middleware
module.exports = function(root, options) {
	if(!options) options = {};

	// The middleware function
	function devtoolsLiveMiddleware(req, res, next) {

		var originalUrl = parseUrl.original(req)
    	var path = parseUrl(req).pathname;

    	if (path[path.length-1] === '/') {
	      path = path.substr(0, (path.length-1)) +'/index.html';
	    }

	    var filepath = root + path;

	    try{

	    if(process.fs.existsSync(filepath)){
	    	var content = process.fs.readFileSync(filepath);
	    }else{
			var stat = fs.statSync(filepath);

	    	if(stat.isFile()) {
	    		var content = fs.readFileSync(filepath);
	    	}else if (stat.isDirectory()) {
	      		filepath = path +'/index.html';
		      	if(fs.statSync(filepath).isFile()){

		      		var content = fs.readFileSync(filepath);

		      	}
	    	}
	    }

		}catch(e){

		}

		if(content === undefined){
			return next();
		}

		var contentType = mime.lookup(filepath);
		res.setHeader("Access-Control-Allow-Origin", "*"); // To support XHR, etc.
		res.setHeader("Content-Type", contentType);
		if(options.headers) {
			for(var name in options.headers) {
				res.setHeader(name, options.headers[name]);
			}
		}

		if(contentType == 'text/html'){
			content = content.toString();
			for(var name in process.live) {
				var tag  = '<!-- '+name+' -->';
				var start = content.indexOf(tag);
				if(start > 0){
					var end = content.lastIndexOf(tag) +tag.length;
					var content = content.substr(0, start)+ process.live[name] + content.substr(end);
				}
			}
		}


		res.setHeader("Content-Length", content.length);
		return res.end(content, 'binary');

	}

	return devtoolsLiveMiddleware;
}
