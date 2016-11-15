var DevtoolsLiveServer = require('devtools-live');

var live = new DevtoolsLiveServer({
	devtools: {
		directory: './app/'
	},
	watch: {
		'./app/': {
			files: ['js/*.js', 'css/*.css', 'index.html']
		}
	},
	connect: {
		port:3000,
		open: true,
		root: './app/'
	}
});

live.start();
