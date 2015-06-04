live-edit
---

live-edit is a Chrome extension that lets you modify running apps without reloading. It's easy to integrate with your build system, dev environment, and can be used with your favorite editor. Read more about it on [https://facebook.github.io/live-edit/](https://facebook.github.io/live-edit/)

## Usage

live-edit is made up of a server and client component. This will guide through configuring your server for your project and installing the Chrome extension.

### 1. Configure live-edit server

```
$ npm install live-edit
```

live-edit exports a single `live-edit` function to start the server. Here is an example where you have your source JavaScript and CSS files in the root directory and your build step involves bundling both into a respective `bundle.js`, `bundle.css`.

```js
var liveEdit = require('live-edit'),
    path = require('path'),
    fs = require('fs');

var server = liveEdit(
  sourceDirToWatch,
  {
    port: 8888,
    host: 'localhost',
    verbose: false,
    glob: [
       // All JS files in `sourceDirToWatch` and subdirectories
      '**/*.js',
       // All CSS files in `sourceDirToWatch` and subdirectories
      '**/*.css'
    ]
  },
  function resolver(filepath, callback) {
    // 1. Call into your compiler / bundler.
    // 2. Assuming that `bundle.js` is your output file, update `bundle.js`
    //    and `bundle.css` when a JS or CSS file changes.
    callback({
      resourceURL: 'bundle' + path.extname(filepath),
      // any string-ish value is acceptable. i.e. strings, Buffers etc.
      contents: fs.readFileSync(filepath),
      update: function(_window, _resourceURL) {
        // this function is executed in the browser, immediately after the resource has been updated with new content
        // perform additional steps here to reinitialize your application so it would take advantage of the new resource
        console.log("Resource " + _resourceURL + " has just been updated with new content");
      }
    });
  }
);
```

`live-edit` takes the following arguments.

* `sourceDirToWatch`: absolute or relative path to the directory to watch that contains the source code that will be built.
* `options` hash of options:
    * `port` port to start the server on (defaults to 8888).
    * `verbose` `true` or `false` value indicating if live-edit should be noisy.
    * `glob` a glob string or array of globs to match against the files to watch.
    * `useWatchman` when watching a large number of folders or where watching is buggy you can use (watchman)[https://facebook.github.io/watchman/].
    * `useFilePolling` some platforms that do not support native file watching, you can force the file watcher to work in polling mode.
    * `pollingInterval` if in polling mode (useFilePolling) then you can set the interval (in milliseconds) at which to poll for file changes.
    * `watchDotFiles` dot files are not watched by default.
* `resolver` a function to map between files and resources.

The resolver callback is called with two arguments:

* `filepath` path to the file that changed relative to the watched directory.
* `callback` called to update a resource file in the browser. Should be called with an object with the following properties:
  * `resourceURL` used as the resource identifier in the browser.
  * `contents` any string-ish value representing the source of the updated file. i.e. strings, Buffers etc.
  * `reload` (optional) forces a full page reload. Use this if you're sure the changed code cannot be hotswapped.
  * `hostname` (optional) used as the resource hostname in the browser (exemple :`http://localhost/` ).
  * `update` (optional) a function that will be executed in the browser, immediately after the resource has been updated. This can be used to run custom code that updates your application. It receives the `window` and the `resourceURL` as parameters. This function will be stringified so it could be sent to the client. Make sure you don't use any variables defined outside this function, as they won't be available, and you will get an error.

### 2. Install the Chrome Extension

Grab the [live-edit Chrome extension](https://chrome.google.com/webstore/detail/ahkfhobdidabddlalamkkiafpipdfchp). This will add a new tab in your Chrome DevTools called 'live-edit'.

### 3. Activate Live Edit

To activate  Live Edit from the browser:

* Open Chrome DevTools.
* Click on the new 'Live Edit' pane.
* Click on 'Activate for this site'

See screenshot:

![](http://i.imgur.com/SamY32i.png)

As an alternative to the `update` function, after any resource is updated, the `live-edit-reload` event will be triggered on the `window`. The event's data will contain the `url` and `contents` that were provided to the `callback` function on the `live-edit-server`. The difference between the the `update` function and the `live-edit-reload` event is that the first one is defined on the server and executed in the client, while the later is defined on the client and executed there as well. It is preferred to use the `update` function, since you won't load your app with code specific to live-editing. Example:
```js
window.addEventListener('live-edit-reload', function(ev) {
    // perform additional steps here to reinitialize your application so it would take advantage of the new resource
    console.log("Resource " + ev.data.url + " has just been replaced with this new content: " + ev.data.contents);
});
```

### Example

Say you have a Makefile program that builds your JavaScript and CSS into `build/build.js` and `build/build.css` respectively, this how you'd configure your live-edit server:

```js
var liveEdit = require('live-edit'),
    fs = require('fs'),
    path = require('path'),
    exec = require('child_process').exec,
    combineSourceMap = require('combine-source-map'),
    srcIndex = require('./build/src'),
    hrefIndex = require('./build/sass');
var style = [] ;
var javascript = [] ;

for (var i in hrefIndex) {

  style[hrefIndex[i].index] = {
    index: hrefIndex[i].links
  };
}

for (var i in srcIndex) {
  javascript[srcIndex[i].index] = {
    src: srcIndex[i].src,
    line: srcIndex[i].line
  };

}

var tasks  = require('./tasks');

function createSourceMap(fileUrl, content) {

  var sourcemap = combineSourceMap.create();

  sourcemap.addFile(
    { sourceFile: fileUrl, source: content.toString('utf8') },
    { line: 1 }
  );

  var comment = sourcemap.comment();
  return new Buffer('\n' + comment + '\n').toString('utf8');
}

function getBrowserifyFileContent(originalFilePath, fileUrl, content) {
  console.log('getBrowserifyFileContent', fileUrl);
  var sourceMapInline = createSourceMap(fileUrl, content);
  var fileContent = javascript[originalFilePath].line +
      '\n' + content + '\n' +
  '}';

  return {
    content:fileContent,
    sourcemap:sourceMapInline
  };
}

var server = liveEdit(['./lib/', './sir-stylist/css/sass/', './templates/'],
{
  port: 8888,
  verbose: true,
  glob: ['**/*.js', '**/*.scss', '**/*.hbs']
},
function resolver(originalFilePath) {

  var fileUrl = originalFilePath.replace(__dirname + '/', '');

  var extension = path.extname(fileUrl);
  var originalFileContent = '';
  console.log('Updating ' + fileUrl);

  if (extension === '.js') {

    var browserifyFilePath = './build' + javascript[originalFilePath].src;

    var record = {
      action: 'update',
      resourceURL: javascript[originalFilePath].src
    };

    if (javascript[originalFilePath].content === undefined) {
      originalFileContent = fs.readFileSync(originalFilePath).toString('utf8');
      record.sync = server.getClientHostname() + '/' + server.getClientPageUrl() + fileUrl;

    }else {
      originalFileContent = javascript[originalFilePath].content;
      delete javascript[originalFilePath].content;
      record.resourceName = server.getClientHostname() + '/' + server.getClientPageUrl() + fileUrl;
    }

    javascript[originalFilePath].sync = originalFileContent;

    var browserifyFile = getBrowserifyFileContent(
                                        originalFilePath,
                                        '/' + server.getClientPageUrl() + fileUrl,
                                        originalFileContent);

    record.content = browserifyFile.content + browserifyFile.sourcemap;

    fs.writeFile(browserifyFilePath, record.content, function(err) {
      if (err) {
        throw err;
      }

      server.broadcast(record);
    });

  } else if (extension === '.scss') {

    var sassFiles = style[originalFilePath].index;
    var sync = true;
    if (style[originalFilePath].content === undefined) {
      originalFileContent = fs.readFileSync(originalFilePath).toString();
    } else {
      originalFileContent = style[originalFilePath].content;
      delete style[originalFilePath].content;
      sync = false;
    }

    style[originalFilePath].sync = originalFileContent;

    sassFiles.forEach(function(sassfilePath) {

      console.log(sassfilePath);

      tasks.css(sassfilePath, sassfilePath.replace(__dirname + '/build', ''), function(url, content) {
        var record  = {
          action: 'update',
          resourceURL: url,
          content: content
        };

        if (sync) {
          record.sync = server.getClientHostname() + '/' + fileUrl;
        }else {
          record.resourceName = server.getClientHostname() + '/' + fileUrl;
        }

        server.broadcast(record);

      });
    });

  } else if (extension === '.hbs') {

    exec('glup js:dev:app', function(err) {
      if (err) {
        throw err;
      }

      server.broadcast({
        action: 'update',
        reload: true
      });
    });
  }
});

server.once('ready', function() {
  console.log('Ready!');
});

server.on('sync', function(message) {

  var extension = path.extname(message.url);
  var key = '';
  var originalFileContent = '';

  if (extension === '.js') {
    key = __dirname + '/' + message.url.replace(server.getClientHostname() + '/' + server.getClientPageUrl(), '');
    if (javascript[key].sync !== undefined) {
      originalFileContent = javascript[key].sync;
      delete javascript[key].sync;
    }
  }else if (extension === '.scss') {
    key = __dirname + '/' + message.url.replace(server.getClientHostname() + '/', '');
    if (style[key].sync !== undefined) {
      originalFileContent = style[key].sync;
      delete style[key].sync;
    }
  }

  if (originalFileContent !== undefined) {
    var url = message.url.replace(server.getClientHostname() + '/', '');
    var record = {
      action: 'sync',
      resourceURL: url,
      content: originalFileContent
    };
    record.resourceName = message.url;

    server.broadcast(record);

  }

});

server.on('update', function(message) {
  var extension = path.extname(message.url);
  var originalFilePath = '';
  if (extension === '.js') {
    originalFilePath = __dirname + '/' + message.url.replace(server.getClientHostname() + '/' + server.getClientPageUrl(), '');
    if (javascript[originalFilePath] !== undefined) {
      javascript[originalFilePath].content = message.content;
    }
  }else if (extension === '.scss') {
    originalFilePath = __dirname + '/' + message.url.replace(server.getClientHostname() + '/', '');
    if (style[originalFilePath] !== undefined) {
      style[originalFilePath].content = message.content;
    }
  }

  fs.writeFileSync(originalFilePath, message.content);

});



```
