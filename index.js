'use strict';

const repl = require('repl')
const lodash = require('lodash')
const exists = require('fs').existsSync
const path = require('path')

const loader = (moduleContext, path) => moduleContext.require(path)

let currentManifest = path.join(process.cwd(), 'package.json')

const FrameworkLoader = () => lodash.attempt(() => {
  if (!exists(currentManifest)) {
    console.error('Make sure to call this from within the context of a skypager project folder with a package.json in it')
    process.exit(1)
  }

  // populate the require.cache in order to get a module context
  require(currentManifest)

  // load skypager-project that would be resolved in process.cwd(), likely node_modules
  global.skypager = loader(require.cache[currentManifest], 'skypager-project')

  if (lodash.isError(global.skypager)) {
    console.error('Could not load the skypager-project library. Make sure it is in process.cwd() node_modules.')
    console.log(global.skypager.message)
    process.exit(1)
  }

  return global.skypager
})


module.exports = exports = start

function ProjectLoader() {
  global.skypager = FrameworkLoader()

  Object.defineProperty(global, 'project', {
    enumerable: false,
    configurable: true,
    get: () => {
      return global.project = global.skypager.load(process.cwd())
    },
  })
}

function start (options, ready) {
  options = lodash.defaults(options, {
    terminal: true,
    colors: true,
    ignoreUndefined: true,
    prompt: `${((currentManifest && currentManifest.name) || 'skypager').magenta} ${'>'.grey}`,
    input: process.stdin,
    output: process.stdout,
    useGlobal: true,
  })

  const server = require('repl').start(options)

  exports.promisify(server)

  if (typeof ready === 'function') {
    ready(server)
  }

  try {
    require(process.cwd() + '/skypager-repl.js')(server)
  } catch(error) {
  }

  ProjectLoader()

  server.defineCommand('cls', {
    help: 'clear the screen',
    action: function(){
      require('cli-clear')()
      this.displayPrompt()
    },
  })

  server.defineCommand('reload', {
    help: 'reload the skypager framework and current project',
    action: function(){
      let cachePaths = () => Object.keys(require.cache).filter( key => key.match(/skypager-/) || key.startsWith(global.project.root))

      try {
        global.skypager.clearProjectCache( )

        cachePaths().forEach(
          cachePath => delete(require.cache[cachePath])
        )

        const attemptReload = lodash.attempt(() => {
          delete global.project
          delete global.skypager

          FrameworkLoader()
          ProjectLoader()
        })

        if (lodash.isError(attemptReload)) {
          console.log('Failed on reload', attemptReload.error)
          process.exit(1)
        }

        if (options.onReload && typeof options.onReload === 'function') {
          options.onReload(global)
        }

        //require('cli-clear')()
        this.displayPrompt()
      } catch(error) {
        console.log('error reloading', error, error.stack)
        //this.displayPrompt()
      }

    },
  })

  return server
}

exports.promisify = function promisify (repl) {
  var realEval = repl.eval;
  var promiseEval = function (cmd, context, filename, callback) {
    realEval.call(repl, cmd, context, filename, function (err, res) {
      // Error response
      if (err) {
        return callback(err);
      }

      // Non-thenable response
      if (!res || typeof res.then != 'function') {
        return callback(null, res);
      }

      // Thenable detected; extract value/error from it

      // Start listening for escape characters, to quit waiting on the promise
      var cancel = function (chunk, key) {
        repl.outputStream.write('break.\n');
        if (key.name === 'escape') {
          process.stdin.removeListener('keypress', cancel);
          callback(null, res);
          // Ensure we don't call the callback again
          callback = function () {};
        }
      };
      process.stdin.on('keypress', cancel);

      // Start a timer indicating that escape can be used to quit
      var hangTimer = setTimeout(function () {
        repl.outputStream.write('Hit escape to stop waiting on promise\n');
      }, 5000);

      res.then(function (val) {
        process.stdin.removeListener('keypress', cancel);
        clearTimeout(hangTimer);
        callback(null, val)
      }, function (err) {
        process.stdin.removeListener('keypress', cancel);
        clearTimeout(hangTimer);
        repl.outputStream.write('Promise rejected: ');
        callback(err);
      }).then(null, function (uncaught) {
        // Rethrow uncaught exceptions
        process.nextTick(function () {
          throw uncaught;
        });
      });
    });
  };

  repl.eval = promiseEval;

  repl.commands['promise'] = {
    help: 'Toggle auto-promise unwrapping',
    action: function () {
      if (repl.eval === promiseEval) {
        this.outputStream.write('Promise auto-eval disabled\n');
        repl.eval = realEval;
      } else {
        this.outputStream.write('Promise auto-eval enabled\n');
        repl.eval = promiseEval;
      }
      this.displayPrompt();
    },
  }
};
