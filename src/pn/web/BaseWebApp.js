﻿;
goog.provide('pn.web.BaseWebApp');
goog.provide('pn.web.ctx');

goog.require('goog.Uri');
goog.require('pn.app.BaseApp');
goog.require('pn.app.WebAppConfig');
goog.require('pn.data.DataDownloader');
goog.require('pn.data.Server');
goog.require('pn.data.Server.EventType');
goog.require('pn.ui.KeyShortcutMgr');
goog.require('pn.ui.LoadingPnl');
goog.require('pn.ui.MessagePanel');
goog.require('pn.ui.UiSpec');
goog.require('pn.ui.UiSpecsRegister');
goog.require('pn.ui.ViewMgr');
goog.require('pn.web.WebAppEvents');



/**
 * @constructor
 * @extends {pn.app.BaseApp}
 * @param {Object=} opt_cfg The configuration options for the
 *    application. These options will be extended on top of the default
 *    pn.app.AppConfig options.
 */
pn.web.BaseWebApp = function(opt_cfg) {
  pn.ass(pn.web.ctx === null, 'Only a single instance of base app supported');

  /** @type {pn.web.BaseWebApp} */
  pn.web.ctx = this;

  this.cfg = new pn.app.WebAppConfig(opt_cfg);
  this.registerDisposable(this.cfg);

  pn.app.BaseApp.call(this);

  /** @type {!pn.ui.ViewMgr} */
  this.view = new pn.ui.ViewMgr(pn.dom.get(this.cfg.viewContainerId));
  this.registerDisposable(this.view);

  /** @type {!pn.ui.MessagePanel} */
  this.msg = new pn.ui.MessagePanel(pn.dom.get(this.cfg.messagePanelId));
  this.registerDisposable(this.msg);


  /** @type {!pn.ui.LoadingPnl} */
  this.loading = new pn.ui.LoadingPnl(pn.dom.get(this.cfg.loadPnlId));
  this.registerDisposable(this.loading);

  /** @type {!pn.ui.KeyShortcutMgr} */
  this.keys = new pn.ui.KeyShortcutMgr();
  this.registerDisposable(this.keys);

  /** @type {!pn.ui.UiSpecsRegister} */
  this.specs = new pn.ui.UiSpecsRegister(this.getUiSpecs());
  this.registerDisposable(this.specs);

  /**
   * @private
   * @type {boolean}
   */
  this.impersonationEnabled_ = false;
};
goog.inherits(pn.web.BaseWebApp, pn.app.BaseApp);


/**
 * A globally accisble handle to the application context.
 * @type {pn.web.BaseWebApp}
 */
pn.web.ctx = null;


/** @override. */
pn.web.BaseWebApp.prototype.getDefaultAppEventHandlers = function() {
  // TODO: We should have a WebAppEvents enumeration
  var evs = goog.base(this, 'getDefaultAppEventHandlers'),
      ae = pn.web.WebAppEvents;

  // Message
  evs[ae.CLEAR_MESSAGE] = this.msg.clearMessage.pnbind(this.msg);
  evs[ae.SHOW_MESSAGE] = this.msg.showMessage.pnbind(this.msg);
  evs[ae.SHOW_MESSAGES] = this.msg.showMessages.pnbind(this.msg);
  evs[ae.SHOW_ERROR] = this.msg.showError.pnbind(this.msg);
  evs[ae.SHOW_ERRORS] = this.msg.showErrors.pnbind(this.msg);
  evs[ae.ENTITY_VALIDATION_ERROR] = this.msg.showErrors.pnbind(this.msg);
  evs[ae.DALOG_SHOWN] = this.keys.disable.pnbind(this.keys);
  evs[ae.DALOG_HIDDEN] = this.keys.enable.pnbind(this.keys);
  evs[ae.LIST_EXPORT] = this.listExport_.pnbind(this);
  evs[ae.LIST_ORDERED] = this.orderEntities_.pnbind(this);

  return evs;
};


/** @override. */
pn.web.BaseWebApp.prototype.init = function() {
  if (this.cfg.enableImpersonation) { this.enableAjaxImpersonisation_(); }

  var sset = pn.data.Server.EventType,
      lp = this.loading;
  goog.events.listen(this.data, sset.LOADING, lp.increment, false, lp);
  goog.events.listen(this.data, sset.LOADED, lp.decrement, false, lp);

  goog.base(this, 'init');
};


/**
 * Impersonation Hack.  Makes all ajax requests impersonate the specified user.
 * @private
 * @suppress {visibility}
 */
pn.web.BaseWebApp.prototype.enableAjaxImpersonisation_ = function() {
  this.impersonationEnabled_ = true;
  var origajax = this.data.server.ajax_.pnbind(this.data.server);
  var impersonate = this.impersonatee();

  this.data.server.ajax_ = function() {
    if (impersonate) arguments[0] += '?impersonate=' + impersonate;
    origajax.apply(null, arguments);
  };
};


/**
 * @protected
 * @return {string} The user name of the person being impersonated.
 */
pn.web.BaseWebApp.prototype.impersonatee = function() {
  if (!this.impersonationEnabled_) return '';
  var qd = new goog.Uri(document.location.href).getQueryData();
  if (!qd.containsKey('impersonate')) return '';
  return qd.getValues('impersonate')[0];
};


/**
 * @protected
 * @param {boolean=} opt_cancelImpersonate Wether to cancel impersonation.
 *    Defaults to false.
 */
pn.web.BaseWebApp.prototype.gohome = function(opt_cancelImpersonate) {
  var uri = this.cfg.appPath;
  var imp = opt_cancelImpersonate === true ? '' : this.impersonatee();
  if (imp) uri += '?impersonate=' + imp;
  document.location.href = uri;
};


/**
 * @param {string} username The username of the user to impersonate if
 *    impersonation is enabled.
 */
pn.web.BaseWebApp.prototype.impersonate = function(username) {
  pn.assStr(username);
  if (!username || username === '0') return;

  if (!this.impersonationEnabled_)
    throw new Error('Impersonation is not enabled');

  window.localStorage.clear();
  var uri = pn.app.ctx.cfg.appPath + '/?impersonate=' +
      username.replace(/ /g, '%20');
  document.location.href = uri;
};


/**
 * A template method used to get all required UiSpecs.  This method should
 *    return an object map (id/ctor pair) with types such as:
 *    {
 *      'Type1': pn.application.specs.Spec1,
 *      'Type1': pn.application.specs.Spec2
 *    {
 *
 * @return {!Object.<!function(new:pn.ui.UiSpec)>} The routes for this
 *    application. The first route is considered the default route.
 */
pn.web.BaseWebApp.prototype.getUiSpecs = goog.abstractMethod;


/** @override */
pn.web.BaseWebApp.prototype.acceptDirty = function() {
  return !this.view.isDirty() ||
      window.confirm('Any unsaved changes will be lost, continue?');
};


/**
 * @private
 * @param {string} type The type of the entity being exported.
 *    This is not used in this fuction but must be there as this is a generic
 *    fireing of event that contains type as the first parameter. See
 *    ExportCommand for details.
 * @param {string} format The export format.
 * @param {Array.<Array.<string>>} data The data to export.
 */
pn.web.BaseWebApp.prototype.listExport_ = function(type, format, data) {
  pn.assStr(type);
  pn.assStr(format);
  pn.assArr(data);
  pn.ass(format !== '0');

  var ed = {'exportType': format, 'exportData': pn.json.serialiseJson(data)};
  var uri = this.cfg.touri('ExportData', 'ExportData');
  pn.data.DataDownloader.send(uri, ed);
};


/**
 * @private
 * @param {string} type The type of the entity to order.
 * @param {!Array.<number>} ids The list of IDs in correct order.
 * @param {function():undefined=} opt_cb The optional callback.
 */
pn.web.BaseWebApp.prototype.orderEntities_ = function(type, ids, opt_cb) {
  pn.assStr(type);
  pn.assArr(ids);

  var data = { 'type': type, 'ids': ids },
      cb = opt_cb || goog.nullFunction,
      uri = this.cfg.touri('GridOrdering', 'OrderGrid');
  this.data.ajax(uri, data, cb);
};


/** @override */
pn.web.BaseWebApp.prototype.disposeInternal = function() {
  goog.base(this, 'disposeInternal');

  var sset = pn.data.Server.EventType,
      lp = this.loading;
  goog.events.unlisten(this.data, sset.LOADING, lp.increment, false, lp);
  goog.events.unlisten(this.data, sset.LOADED, lp.decrement, false, lp);
};
