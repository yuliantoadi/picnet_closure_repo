
goog.provide('pn.app.BaseApp');

goog.require('goog.debug.Logger');
goog.require('goog.events.EventHandler');
goog.require('goog.events.EventHandler');
goog.require('goog.pubsub.PubSub');
goog.require('pn');
goog.require('pn.app.AppConfig');
goog.require('pn.app.EventBus');
goog.require('pn.app.Router');
goog.require('pn.data.BaseFacade');
goog.require('pn.data.LazyFacade');
goog.require('pn.log');


/**
 * A globally accisble handle to the application context.
 * @type {pn.app.BaseApp}
 */
pn.app.ctx = null;



/**
 * This is the main starting point to any pn.app application. Extend this class
 * and implement the following methods:
 *
 * getRoutes: Returns a name/callback map that respond to the browser '#' hash
 *   changes and allows for bookmarking and proper history management.
 *
 * getUiSpecs: Returns a set of types that implement pn.ui.UiSpec.  These are
 *   specs that leverage the pn.ui package.
 *
 * getAppEventHandlers: Returns a name/callback map that respond to
 *   pn.app.ctx.pub calls.  These events/callbacks are not bookmarkable.
 *
 * disposeInternal: Dispose any created entity here.  Ensure you call
 *   superClass_.disposeInternal.
 *
 * If any of the default settings need to be changed just change the appropriate
 *   setting in pn.app.ctx.cfg.
 *
 * @constructor
 * @param {Object=} opt_cfg The configuration options for the
 *    application. These options will be extended on top of the default
 *    pn.app.AppConfig options.
 * @extends {goog.events.EventHandler}
 */
pn.app.BaseApp = function(opt_cfg) {
  goog.events.EventHandler.call(this);
  pn.ass(pn.app.ctx === null, 'Only a single instance of base app supported');

  // Create a globally accessible handle to the application context
  pn.app.ctx = this;

  /**
   * @protected
   * @type {goog.debug.Logger}
   */
  this.log = pn.log.getLogger('pn.app.BaseApp');
  this.log.info('Creating Application');

  /** @type {!pn.app.Router} */
  this.router = new pn.app.Router();
  this.registerDisposable(this.router);

  /** @type {!pn.app.AppConfig} */
  this.cfg = this.cfg || new pn.app.AppConfig(opt_cfg);
  this.registerDisposable(this.cfg);

  /**
   * @protected
   * @type {!pn.data.LocalCache}
   */
  this.cache = new pn.data.LocalCache(this.cfg.dbver);

  /**
   * @protected
   * @type {!pn.data.Server}
   */
  this.server = new pn.data.Server(this.cfg.facadeUri);

  /** @type {!pn.data.BaseFacade} */
  this.data = new pn.data.LazyFacade(this.cache, this.server);
  this.registerDisposable(this.data);
  this.registerDisposable(this.server);
  this.registerDisposable(this.cache);

  /**
   * @private
   * @type {!pn.app.EventBus}
   */
  this.bus_ = new pn.app.EventBus(this.cfg.useAsyncEventBus);
  this.registerDisposable(this.bus_);

  // Convenience delegates.
  /**
   * @param {string} topic Topic to publish to.
   * @param {...*} var_args Arguments that are applied to each sub function.
   */
  this.pub = goog.bind(this.bus_.pub, this.bus_);

  /** @return {string} The current topic being submitted. */
  this.topic = goog.bind(this.bus_.topic, this.bus_);
};
goog.inherits(pn.app.BaseApp, goog.events.EventHandler);

////////////////////////////////////////////////////////////////////////////////
// REQUIRED TEMPLATE METHODS
////////////////////////////////////////////////////////////////////////////////


/**
 * A template method used to get all required routes.  This method should
 *    return a routes map in the format:
 *    {
 *      'route-name1': callback1,
 *      'route-name2': callback2
 *    }
 * The first route is considered the default route.
 *
 * To navigate to a rounte simple call
 *    pn.app.ctx.router.navigate('path/including/args')
 *
 * @protected
 * @return {!Object.<!Function>} The routes for this application. The first
 *    route is considered the default route.
 */
pn.app.BaseApp.prototype.getRoutes = goog.abstractMethod;


/**
 * A template method used to get all required event handlers.  These event
 *    handlers will respond to the pn.app.ctx.pub('event-name', args) calls.
 *
 *    The map should be in the following format:
 *    {
 *      'event-name-1': callback1,
 *      'event-name-2': callback2
 *    {
 *
 * @protected
 * @return {Object.<!Function>} The event handlers for handling
 *    pn.app.ctx.pub('event-name', args) calls.
 */
pn.app.BaseApp.prototype.getAppEventHandlers = function() { return null; };


/**
 * A template method used to determine if the user is happy to leave the
 *    current page.  The default implementation is to always return true.
 *    However WebApps override this to do proper dirty checking.
 *
 * @return {boolean} Wether the user is happy to navigate away from the
 *    current page.
 */
pn.app.BaseApp.prototype.acceptDirty = function() { return true; };

////////////////////////////////////////////////////////////////////////////////
// PRIVATE IMPLEMENTATION DETAILS
////////////////////////////////////////////////////////////////////////////////


/**
 * Needs to be called by implementing class to initialise the application.
 * @protected
 */
pn.app.BaseApp.prototype.init = function() {
  goog.events.listen(window, 'unload', goog.bind(this.dispose, this));

  var eventBusEvents = this.getDefaultAppEventHandlers();
  var additional = this.getAppEventHandlers();
  if (additional) goog.object.extend(eventBusEvents, additional);
  for (var event in eventBusEvents) {
    this.bus_.sub(event, eventBusEvents[event]);
  }

  var navevent = pn.app.Router.EventType.NAVIGATING;
  goog.events.listen(this.router, navevent, this.acceptDirty, false, this);

  this.router.initialise(this.getRoutes());
};


/** @return {!Object} The default/generic event handlers. */
pn.app.BaseApp.prototype.getDefaultAppEventHandlers = function() {
  var evs = {},
      ae = pn.app.AppEvents,
      bind = goog.bind;

  // Data
  evs[ae.QUERY] = bind(this.data.query, this.data);
  evs[ae.ENTITY_SAVE] = bind(function(type, raw, opt_cb) {
    var entity = pn.data.TypeRegister.create(type, raw);
    var cb = opt_cb ||
        goog.bind(function(e) { this.pub(ae.ENTITY_SAVED, e); }, this);
    if (entity.id > 0) { this.data.updateEntity(entity, cb); }
    else { this.data.createEntity(entity, cb); }
  }, this);
  evs[ae.ENTITY_CLONE] = bind(function(type, raw) {
    var entity = pn.data.TypeRegister.create(type, raw);
    this.cloneEntity_(entity);
  }, this);
  evs[ae.ENTITY_DELETE] = bind(function(type, raw) {
    var entity = pn.data.TypeRegister.create(type, raw);
    var cb = goog.bind(function() { this.pub(ae.ENTITY_DELETED); }, this);
    this.data.deleteEntity(entity, cb);
  }, this);
  evs[ae.ENTITY_CANCEL] = bind(this.router.back, this.router);
  evs[ae.SHOW_DEBUG_MESSAGE] = this.showDebugMessage;
  return evs;
};


/**
 * @protected
 * @param {string} msg The server debug message to alert the user to.
 *  This can be overriden if alerts are not appropriate.
 */
pn.app.BaseApp.prototype.showDebugMessage = function(msg) {
  pn.log.info(msg);
  window.alert(msg);
};


/**
 * @private
 * @param {!pn.data.Entity} entity The entity to clone.
 */
pn.app.BaseApp.prototype.cloneEntity_ = function(entity) {
  pn.assInst(entity, pn.data.Entity);

  if (!this.acceptDirty()) return;

  var json = pn.json.serialiseJson(entity.toJsonObject()),
      data = { 'type': entity.type, 'entityJson': json },
      uri = this.cfg.touri('CloneEntity', 'CloneEntity');

  this.data.ajax(uri, data, function(cloned) {
    cloned = pn.data.TypeRegister.parseEntity(entity.type, cloned);
    pn.app.ctx.pub(pn.app.AppEvents.ENTITY_CLONED, entity.type, cloned);
  });
};


/** @override */
pn.app.BaseApp.prototype.disposeInternal = function() {
  pn.app.BaseApp.superClass_.disposeInternal.call(this);

  this.log.info('Disposing Application');

  var navevent = pn.app.Router.EventType.NAVIGATING;
  goog.events.unlisten(this.router, navevent, this.acceptDirty, false, this);
};
