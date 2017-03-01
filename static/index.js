(function () {
  const electron = require('electron')
  const path = require('path')
  const Module = require('module')
  const getWindowLoadSettings = require('../src/get-window-load-settings')
  const entryPointDirPath = __dirname
  let useSnapshot = false

  window.onload = function () {
    try {
      const startTime = Date.now()

      process.on('unhandledRejection', function (error, promise) {
        console.error('Unhandled promise rejection %o with error: %o', promise, error)
      })

      // Normalize to make sure drive letter case is consistent on Windows
      process.resourcesPath = path.normalize(process.resourcesPath)

      setupAtomHome()
      const devMode = getWindowLoadSettings().devMode || !getWindowLoadSettings().resourcePath.startsWith(process.resourcesPath + path.sep)
      useSnapshot = !devMode && typeof snapshotResult !== 'undefined'

      if (devMode) {
        const metadata = require('../package.json')
        if (!metadata._deprecatedPackages) {
          try {
            metadata._deprecatedPackages = require('../script/deprecated-packages.json')
          } catch (requireError) {
            console.error('Failed to setup deprecated packages list', requireError.stack)
          }
        }
      } else if (useSnapshot) {
        Module.prototype.require = function (module) {
          const absoluteFilePath = Module._resolveFilename(module, this, false)
          const relativeFilePath = path.relative(entryPointDirPath, absoluteFilePath)
          let cachedModule = snapshotResult.customRequire.cache[relativeFilePath]
          if (!cachedModule) {
            cachedModule = Module._load(module, this, false)
            snapshotResult.customRequire.cache[relativeFilePath] = cachedModule
          }
          return cachedModule
        }

        snapshotResult.setGlobals(global, process, window, document, require)
        snapshotResult.entryPointDirPath = __dirname
      }

      if (getWindowLoadSettings().profileStartup) {
        profileStartup(Date.now() - startTime)
      } else {
        setupWindow()
        setLoadTime(Date.now() - startTime)
      }
    } catch (error) {
      handleSetupError(error)
    }
  }

  function setLoadTime (loadTime) {
    if (global.atom) {
      global.atom.loadTime = loadTime
    }
  }

  function handleSetupError (error) {
    const currentWindow = electron.remote.getCurrentWindow()
    currentWindow.setSize(800, 600)
    currentWindow.center()
    currentWindow.show()
    currentWindow.openDevTools()
    console.error(error.stack || error)
  }

  function setupWindow () {
    const CompileCache = useSnapshot ? snapshotResult.customRequire('../src/compile-cache.js') : require('../src/compile-cache')
    CompileCache.setAtomHomeDirectory(process.env.ATOM_HOME)
    CompileCache.install(require)

    const ModuleCache = useSnapshot ? snapshotResult.customRequire('../src/module-cache.js') : require('../src/module-cache')
    ModuleCache.register(getWindowLoadSettings())

    const startCrashReporter = useSnapshot ? snapshotResult.customRequire('../src/crash-reporter-start.js') : require('../src/crash-reporter-start')
    startCrashReporter({_version: getWindowLoadSettings().appVersion})

    const CSON = useSnapshot ? snapshotResult.customRequire('../node_modules/season/lib/cson.js') : require('season')
    CSON.setCacheDir(path.join(CompileCache.getCacheDirectory(), 'cson'))

    const initScriptPath = path.relative(entryPointDirPath, getWindowLoadSettings().windowInitializationScript)
    const initialize = useSnapshot ? snapshotResult.customRequire(initScriptPath) : require(initScriptPath)
    return initialize().then(function () {
      electron.ipcRenderer.send('window-command', 'window:loaded')
    })
  }

  function profileStartup (initialTime) {
    function profile () {
      console.profile('startup')
      const startTime = Date.now()
      setupWindow().then(function () {
        setLoadTime(Date.now() - startTime + initialTime)
        console.profileEnd('startup')
        console.log('Switch to the Profiles tab to view the created startup profile')
      })
    }

    const webContents = electron.remote.getCurrentWindow().webContents
    if (webContents.devToolsWebContents) {
      profile()
    } else {
      webContents.once('devtools-opened', () => { setTimeout(profile, 1000) })
      webContents.openDevTools()
    }
  }

  function setupAtomHome () {
    if (process.env.ATOM_HOME) {
      return
    }

    // Ensure ATOM_HOME is always set before anything else is required
    // This is because of a difference in Linux not inherited between browser and render processes
    // https://github.com/atom/atom/issues/5412
    if (getWindowLoadSettings() && getWindowLoadSettings().atomHome) {
      process.env.ATOM_HOME = getWindowLoadSettings().atomHome
    }
  }
})()
