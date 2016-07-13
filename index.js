'use strict';

const repl = require('repl')
const lodash = require('lodash')
const exists = require('fs').existsSync
const path = require('path')
const argv = require('minimist')(process.argv)
const emoji = require('node-emoji')

/**
 * Loads a module in the context of another module.
 *
 * If the moduleContext you pass in is a string, it will attempt to load a module
 * object from require.cache
 *
 * @param  {module|string} moduleContext The module, or the id of a module found in require.cache
 * @param  {[type]} path          the require expression to be required / resolved
 * @return module
 */
const loader = (moduleContext, moduleId) => {
  try {
    return typeof moduleContext === 'string'
      ? lodash.attempt(require(moduleContext)) && loader(require.cache[moduleContext], moduleId)
      : moduleContext.require(moduleId)
  } catch(error) {
    return require('skypager-project')
  }
}

const getContextPath = () => {
  const contextRoot = argv.skypagerRoot || process.env.SKYPAGER_ROOT
  return contextRoot
    ? path.join(contextRoot, 'package.json')
    : path.join(process.cwd(), 'package.json')
}

exports.contextPath = getContextPath

const FrameworkLoader = (contextPath = getContextPath(), context = global) => lodash.attempt(() => {
  if (!exists(contextPath)) {
    console.error('Make sure to call this from within the context of a skypager project folder with a package.json in it')
    process.exit(1)
  }

  // populate the require.cache in order to get a module context
  require(contextPath)

  // load skypager-project that would be resolved in process.cwd(), likely node_modules
  const theFramework = loader(contextPath, 'skypager-project')

  if (lodash.isError(theFramework)) {
    console.error('Could not load the skypager-project library. Make sure it is in process.cwd() node_modules.')
    console.log(theFramework.message)
    process.exit(1)
  }

  return context.skypager = theFramework
})


module.exports = exports = start
exports.start = start
exports.loadFramework = FrameworkLoader
exports.loadProject = ProjectLoader


function ProjectLoader(context) {
  context = context || global

  delete context.project

  context.skypager = FrameworkLoader()

  Object.defineProperty(context, 'project', {
    enumerable: false,
    configurable: true,
    get: () => {
      delete(context.project)
      return context.project = context.skypager.load(process.cwd())
    },
  })
}

function start (options = {}, context = global, ready) {
  const _currentPackage = require(getContextPath())
  const icon = options.icon ? `${emoji.get(options.icon)} ` : ''

  options = lodash.defaults(options, {
    terminal: true,
    colors: true,
    ignoreUndefined: true,
    prompt: `${icon}${((_currentPackage && _currentPackage.name) || 'skypager').magenta}${'>'.grey} `,
    input: process.stdin,
    output: process.stdout,
    useGlobal: true,
  })

  const server = require('repl').start(options)

  if (lodash.isError(server)) {
    ready(server, null)
    return
  }

  try {
    exports.promisify(server)

    if (exists(path.join( process.cwd() + '/skypager-repl.js' ))) {
      require(process.cwd() + '/skypager-repl.js')(server)
    }

    ProjectLoader(options.useGlobal ? global : server.context)

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
        let cachePaths = () => Object.keys(require.cache).filter( key => key.match(/skypager-/) || key.startsWith(context.project.root))

        try {
          context.skypager.clearProjectCache( )

          cachePaths().forEach(
            cachePath => delete(require.cache[cachePath])
          )

          const attemptReload = lodash.attempt(() => {
            delete context.project
            delete context.skypager

            FrameworkLoader(getContextPath(), options.useGlobal ? global : server.context)
            ProjectLoader(options.useGlobal ? global : server.context)
          })

          if (lodash.isError(attemptReload)) {
            console.log('Failed on reload', attemptReload.error)
            process.exit(1)
          }

          if (options.onReload && typeof options.onReload === 'function') {
            options.onReload(context)
          }

          //require('cli-clear')()
          this.displayPrompt()
        } catch(error) {
          console.log('error reloading', error, error.stack)
          //this.displayPrompt()
        }

      },
    })
  } catch(error) {
    ready(error)
    return
  }


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
