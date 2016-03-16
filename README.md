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
var LiveDevtools = require('devtools-live');


var live = new LiveDevtools({
	debug:true,
	verbose:true,
	devtools : {
		directory: './client/',
		port: 8888
	},
	watch : {
		'./client/' : {
			files : ['**/*.js','**/*.css']
		}
	}
});


live.start();
```
