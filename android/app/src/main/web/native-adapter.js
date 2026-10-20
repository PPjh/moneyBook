/* Only bundled local content can access this allow-listed bridge. Never loaded by the PWA. */
(function () {
  'use strict';
  if (!window.MoneyBookNative) throw new Error('安卓本机服务不可用，已停止写入');
  document.documentElement.dataset.platform = 'android';
  var bridge = window.MoneyBookNative, serial = 0, pending = Object.create(null), runtime;
  var session = Date.now().toString(36) + Math.random().toString(36).slice(2);
  var recordsBaseline;
  function call(operation, args) {
    var result = JSON.parse(bridge.call(operation, JSON.stringify(args || {})));
    if (!result.ok) throw new Error(result.error || '本机操作未完成');
    return result.value;
  }
  function request(operation, args) {
    return new Promise(function (resolve, reject) {
      var id = session + '-' + (++serial);
      pending[id] = { resolve: resolve, reject: reject };
      try { bridge.request(id, operation, JSON.stringify(args || {})); }
      catch (error) { delete pending[id]; reject(error); }
    });
  }
  window.__moneybookResolve = function (id, result) {
    var task = pending[id]; if (!task) return;
    delete pending[id];
    if (result.ok) task.resolve(result.value);
    else task.reject(new Error(result.error || '本机操作未完成'));
  };
  var info = call('info');
  window.MoneyBookPlatform = {
    version: info.version,
    storage: {
      getItem: function (key) {
        var value = call('get', { key: key });
        if (key === 'jz.records.v1') recordsBaseline = value;
        return value;
      },
      setItem: function (key, value) {
        call('set', { key: key, value: String(value), expected: recordsBaseline });
      },
      removeItem: function () { throw new Error('不允许直接删除本机数据库'); }
    },
    folder: function () { return call('folder'); },
    chooseFolder: function () { return request('chooseFolder'); },
    forgetFolder: function () { return request('forgetFolder'); },
    backup: function () { return request('backup'); },
    saveFile: function (name, text, mime) { return request('saveFile', { name: name, text: text, mime: mime }); },
    importFile: function () { return request('importFile'); },
    snapshots: function () { return call('snapshots'); },
    snapshot: function (reason) { return call('snapshot', { reason: reason }); },
    retainSnapshots: function (list) { return call('retainSnapshots', { keep: list.map(function (item) { return item.nativeId; }) }); },
    importRows: function (rows, mode, config, expected) { return call('import', { rows: rows, mode: mode, config: config || {}, expected: expected }); },
    biometricInfo: function () { return call('biometricInfo'); },
    setBiometric: function (enabled) { return request('biometricAuth', { action: enabled ? 'enable' : 'disable' }); },
    lock: function () { return call('lock'); },
    theme: function (theme) { call('theme', { theme: theme }); },
    pickerBusy: function () { return Object.keys(pending).length > 0; },
    connect: function (callbacks) {
      runtime = callbacks;
      call('ready'); // The native host, never a JS claim, owns visibility of the locked ledger.
    },
    resume: function (shouldLock) { if (runtime) runtime.resume(shouldLock); },
    back: function () { return runtime ? runtime.back() : false; }
  };
})();
