'use strict';

var _ = require('lodash');
var exec = require('child_process').exec;

function ExecResolver(options) {
	options =  _.assign({
      cmd: '',
      reload : false
  }, options);

	this.cmd = options.cmd;
	this.reload = options.reload;

}

ExecResolver.prototype.resolve = function(originalFilePath, fileUrl, server, errorHandler) {

	if(this.cmd == ''){

		server.broadcast({
	      action: 'update',
	      reload: this.reload
	    });

	}else{

		exec(this.cmd, function(err) {
    if (err) {
      throw err;
    }

    server.broadcast({
      action: 'update',
      reload: this.reload
    });

		}.bind(this));

	}


};

module.exports = ExecResolver;

