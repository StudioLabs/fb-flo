DevtoolsLive
---

DevtoolsLive is a Chrome extension that lets you modify running apps without reloading. It's easy to integrate with your build system, dev environment, and can be used with your favorite editor. 


## Usage

DevtoolsLive is made up of a server and client component. This will guide through configuring your server for your project and installing the Chrome extension.



### 1. Install Chrome Extension

Grab the [https://chrome.google.com/webstore/detail/devtools-live/mibfmhaegkllojggdbddpfdimhmbhkcn?hl](Devtools Live extension). This will add a new tab in your Chrome DevTools called 'Live'.

or 

Visit chrome://extensions in your browser (or open up the Chrome menu by clicking the icon to the far right of the Omnibox:  The menu's icon is three horizontal bars. and select Extensions under the Tools menu to get to the same place).

Ensure that the Developer mode checkbox in the top right-hand corner is checked.

Click Load unpacked extension… to pop up a file-selection dialog.

Navigate to the devtools Live directory  and go to src.

Select the Client folder.


### 2. Configure DevtoolsLive server

```
$ npm install devtools-live
```

Create a config file named live.js:

```js
var LiveDevtools = require('devtools-live');
 
var live = new LiveDevtools({
	devtools : {
		directory: './src/'
	},
	watch : {
		'./src/' : {
			files : ['js/*.js','css/*.css']
		}
	},
	connect : {
		port:3000,
		open: true,
		root: './src/'
	}
});
 
live.start();
```

### 3. Run the server

```
$ node live.js
```

### 4. Configure Devtools Live

Go to the Live extension in  chrome devtools. Go to configuration and add your server configuration.

Devtools Live will normally be connected automatically.


### 5. Edit your code 

Now you can edit your code when devtools live is open, in your editor or in the devtools Source tab.







