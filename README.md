# Custom Tailored REPL

A promisified REPL with some other nice features.

## Installation

```
npm install skypager-repl -g
```

## Usage

Use the repl in any skypager project directory.  You will be provided with a repl that supports babel, using the babel-preset-skypager preset, as well as some enhanced repl commands such as `.cls` or `.reload`.  You will also have a global `project` variable available that represents the skypager project found in your cwd.

### Customization of the REPL context

If there is a file `skypager-repl.js` found in `process.cwd()`, it can export a function which accepts the instance of the repl.  You can add stuff to the repl context here, which will make it available to you as a local variable.  This is useful for capturing common and repetitive debugging tasks in your project, for example.
