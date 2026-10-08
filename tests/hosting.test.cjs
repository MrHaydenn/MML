const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { HOST_URL, isHostUrl, createHosting } = require('../electron/hosting.cjs');

test('hosting URL policy accepts MMSM paths and rejects lookalikes or unsafe schemes', () => {
  assert.equal(isHostUrl(`${HOST_URL}servers?tab=overview`), true);
  for (const url of ['http://mmsm.mrhaydenn.us', 'https://mmsm.mrhaydenn.us.evil.test', 'https://mmsm.mrhaydenn.us@evil.test', 'file:///C:/secret', 'javascript:alert(1)']) assert.equal(isHostUrl(url), false);
});

test('embedded content is isolated, hidden on tab changes, and closed with the launcher', () => {
  const window = new EventEmitter();
  Object.assign(window, { isDestroyed: () => false, getContentSize: () => [1440, 940], webContents: { send: () => {} }, contentView: { addChildView: () => {} } });
  let view, preferences;
  const opened = [];
  function FakeView(options) {
    preferences = options.webPreferences;
    view = this;
    this.webContents = new EventEmitter();
    Object.assign(this.webContents, {
      session: { setPermissionRequestHandler: fn => { this.permissions = fn; }, setPermissionCheckHandler: () => {} },
      setWindowOpenHandler: fn => { this.popup = fn; }, loadURL: async url => { this.url = url; },
      isDestroyed: () => false, close: () => { this.closed = true; }, stop: () => {}
    });
    this.setBackgroundColor = () => {};
    this.setVisible = value => { this.visible = value; };
    this.setBounds = value => { this.bounds = value; };
  }
  const hosting = createHosting(window, { WebContentsView: FakeView, shell: { openExternal: async url => { opened.push(url); } } });
  hosting.show();
  assert.equal(view.url, HOST_URL);
  assert.deepEqual(preferences, { contextIsolation: true, nodeIntegration: false, sandbox: true, partition: 'persist:mml-hosting' });
  assert.equal(preferences.preload, undefined);
  hosting.setLayout({ visible: true, bounds: { x: 268, y: 280, width: 1136, height: 600 } });
  view.webContents.emit('did-finish-load'); assert.equal(view.visible, true);
  hosting.setLayout({ visible: false }); assert.equal(view.visible, false);
  hosting.setLayout({ visible: true, bounds: { x: 268, y: 280, width: 1136, height: 600 } });
  view.webContents.emit('did-start-loading');
  view.webContents.emit('did-fail-load', {}, -105, 'NAME_NOT_RESOLVED', HOST_URL, true);
  view.webContents.emit('did-finish-load');
  assert.equal(hosting.status().state, 'error'); assert.equal(view.visible, false);
  view.webContents.emit('did-start-loading'); view.webContents.emit('did-finish-load');
  assert.equal(hosting.status().state, 'ready'); assert.equal(view.visible, true);
  let prevented = false;
  view.webContents.emit('will-navigate', { preventDefault: () => { prevented = true; } }, 'https://example.com');
  assert.equal(prevented, true); assert.deepEqual(opened, ['https://example.com/']);
  view.popup({ url: 'file:///C:/secret' }); assert.equal(opened.length, 1);
  assert.throws(() => hosting.setLayout({ visible: true, bounds: { x: NaN } }), /Invalid hosting layout/);
  window.emit('closed'); assert.equal(view.closed, true);
});
