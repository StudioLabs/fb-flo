DevtoolsLive
---

DevtoolsLive is a Chrome extension that lets you modify running apps without reloading. It's easy to integrate with your build system, dev environment, and can be used with your favorite editor. Read more about it on [https://studiolabs.github.io/devtools-live/](https://StudioLabs.github.io/devtools-live/)

## Usage

DevtoolsLive is made up of a server and client component. This will guide through configuring your server for your project and installing the Chrome extension.

### 1. Configure DevtoolsLive server

```
$ npm install devtools-live
```

DevtoolsLive exports a single `DevtoolsLive` function to start the server. Here is an example where you have your source JavaScript and CSS files in the root directory and your build step involves bundling both into a respective `bundle.js`, `bundle.css`.

```js
var devtoolsLive = require('devtools-live'),

var server = devtoolsLive({
	port: 8888,
	dir :'./build',
	watchers : {
		'./js/' : {
				files : ['**/*.js']
		},
		'./css/' : {
				files : ['**/*.css']
		}
	}
);
```
server.once('ready', function() {
	console.log('Ready!');
});


`DevtoolsLive` takes the following arguments.

* `options` hash of options:
	* `port` port to start the server on (defaults to 8888). 
	* `src` config to use a map between files and resources.
	* `dest` config to use a map between files and resources.
	* `verbose` `true` or `false` value indicating if DevtoolsLive should be noisy.
	* `resolvers` config to use a map between files and resources.
	* `watchers` folders to watch.
		* `files` an array of globs to match against the files to watch.
		* `useWatchman` when watching a large number of folders or where watching is buggy you can use (watchman)[https://StudioLabs.github.io/watchman/].
		* `useFilePolling` some platforms that do not support native file watching, you can force the file watcher to work in polling mode.
		* `pollingInterval` if in polling mode (useFilePolling) then you can set the interval (in milliseconds) at which to poll for file changes.
		* `watchDotFiles` dot files are not watched by default.
 

### 2. Install the Chrome Extension

Grab the [DevtoolsLive Chrome extension](https://chrome.google.com/webstore/detail/ahkfhobdidabddlalamkkiafpipdfchp). This will add a new tab in your Chrome DevTools called 'DevtoolsLive'.

### 3. Activate Live Edit

To activate  Live Edit from the browser:

* Open Chrome DevTools.
* Click on the new 'Live Edit' pane.
* Click on 'Activate for this site'

See screenshot:

![](http://i.imgur.com/SamY32i.png)

```

### Example

Say you have a Makefile program that builds your JavaScript with browserify in `build/build.js` and your CSS with sass into `build/build.css`. This how you'd configure your DevtoolsLive server:

```js
var devtoolsLive = require('devtools-live'),
		fs = require('fs'),
		path = require('path');

var tasks  = require('./tasks');

var server = devtoolsLive({
	port: 8888,
	verbose: true,
	dir :'./build',
	resolvers : {
		 '.js' : {
				resolver : 'browserify',
				map : './build/src'
		},
		'.scss' : {
				resolver : 'sass',
				cmd : tasks.css.live,
				map : './build/sass'
		},
		'.hbs' : {
				resolver : 'exec',
				cmd : 'glup js:dev:app:live',
				reload : true
		}
	},
	watchers : {
		'./lib/' : {
				files : ['**/*.js']
		},
		'./sir-stylist/css/sass/' : {
				files : ['**/*.scss']
		},
		'./templates/' : {
				files : ['**/*.hbs']
		}
	}
});

server.once('ready', function() {
	console.log('Ready!');
});


```
