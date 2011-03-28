﻿goog.require('goog.Disposable');
goog.require('goog.array');
goog.require('goog.object');
goog.require('picnet.Utils');

goog.require('picnet.data.IDataProvider');
goog.require('picnet.data.IEntity');
goog.require('picnet.data.IRepository');
goog.require('picnet.data.TransactionResult');

goog.provide('picnet.data.LocalDataProvider');



/**
 * @constructor
 * @implements {picnet.data.IDataProvider}
 * @extends {goog.Disposable}
 * @param {!picnet.data.IRepository} repository The repository to use for
 *    storing local data.
 */
picnet.data.LocalDataProvider = function(repository) {
  goog.Disposable.call(this);

  /**
   * @type {!picnet.data.IRepository}
   */
  this.repository = repository;
};
goog.inherits(picnet.data.LocalDataProvider, goog.Disposable);


/** @inheritDoc */
picnet.data.LocalDataProvider.prototype.getEntities = function(type) {
  throw new Error('LocalDataProvider.getEntities not supported');
  // this.repository.getList(type, callback, handler);
};


/** @inheritDoc */
picnet.data.LocalDataProvider.prototype.getEntity = function(type, id) {
  throw new Error('LocalDataProvider.getEntity not supported');
  // this.repository.getItem(type, id, callback, handler);
};


/**
 * A counter used to ensure that the IDs set on local entities
 *    are always unique.
 * @private
 * @type {number}
 */
picnet.data.LocalDataProvider.prototype.localSaveEntityIndex_ = 0;


/** @inheritDoc */
picnet.data.LocalDataProvider.prototype.saveEntity =
    function(type, data, callback, handler) {
  var clientid = 0;
  if (typeof(data) !== 'number' && !data.ID) {
    // new entities get a negative ID for locals
    clientid = data.ID;
    this.setValidEntityIDPreSave_(data);
  }
  this.repository.saveItem(type, data, function() {
    callback.call(handler || this,
        {'ClientID': clientid, 'ID': data.ID, 'Errors': []});
  }, handler);
};


/**
 * @param {string} type The type of the unsaved entity.
 * @param {!picnet.data.IEntity} data The entity data.
 * @param {!function()} callback The success callback.
 * @param {Object=} handler The context to use when calling the callback.
 */
picnet.data.LocalDataProvider.prototype.saveUnsavedEntity =
    function(type, data, callback, handler) {
  this.repository.saveItem('UnsavedEntities|' + type, data, function() {
    callback.call(handler || this);
  }, this);
};


/**
 * @param {!Object.<string, !Array.<picnet.data.IEntity>>} data The unsaved
 *    entities map.
 * @param {!function()} callback The success callback.
 * @param {Object=} handler The context to use when calling the callback.
 */
picnet.data.LocalDataProvider.prototype.saveUnsavedEntities =
    function(data, callback, handler) {
  for (var type in data) {
    this.repository.saveList('UnsavedEntities|' + type, data[type],
        function() {
          callback.call(handler || this);
        }, this);
  }
};


/** @inheritDoc */
picnet.data.LocalDataProvider.prototype.saveEntities =
    function(data, callback, handler) {
  var types = goog.object.getKeys(data);
  this.saveEntitiesImpl_(types, data, callback, handler);
};


/**
 * @private
 * @param {!Array.<string>} types The types of entities to save (this list is
 *    popped recursively).
 * @param {!Object.<string, !Array.<picnet.data.IEntity>>} data The entity map
 *    to save.
 * @param {!function(Array.<picnet.data.TransactionResult>)} callback The
 *    success callback.
 * @param {Object=} handler The context to use when calling the callback.
 */
picnet.data.LocalDataProvider.prototype.saveEntitiesImpl_ =
    function(types, data, callback, handler) {
  if (!types || types.length === 0) {
    callback.call(handler, []);
    return;
  }
  var type = types.pop();
  var entities = data[type];
  goog.array.forEach(entities, this.setValidEntityIDPreSave_, this);
  this.repository.saveList(type, entities, function(success) {
    if (!success) {
      callback.call(handler || this, [{Errors: 'Unknown Error'}]);
      return;
    }
    this.saveEntitiesImpl_(types, data, callback, handler);
  }, this);
};


/** @inheritDoc */
picnet.data.LocalDataProvider.prototype.deleteEntity =
    function(type, id, callback, handler) {
  this.repository.deleteItem('UnsavedEntities|' + type, id, function() {
    // Offline Delete, add to the Deleted_type list for later server update
    this.repository.deleteItem(type, id, function(result) {
      if (callback) callback.call(handler || this, result);
    }, this);
  }, this);
};


/** @inheritDoc */
picnet.data.LocalDataProvider.prototype.deleteEntities =
    function(type, ids, callback, handler) {
  this.repository.deleteItems('UnsavedEntities|' + type, ids, function() {
    // Offline Delete, add to the Deleted_type list for later server update
    this.repository.deleteItems(type, ids, function(result) {
      if (callback) callback.call(handler || this, result);
    }, this);
  }, this);
};


/**
 * @param {string} type The type of the local deleted eneity.
 * @param {number} id The ID of the entity that has been deleted.
 * @param {!function()} callback The success callback.
 * @param {Object=} handler The context to use when calling the callback.
 */
picnet.data.LocalDataProvider.prototype.saveDeletedEntity =
    function(type, id, callback, handler) {
  if (id < 0) {
    callback.call(handler || this);
    return;
  }
  this.repository.saveItem('DeletedIDs|' + type, id, function() {
    callback.call(handler || this);
  }, this);
};


/**
 * @param {string} type The type of the entities that have been deleted.
 * @param {!Array.<number>} ids The IDs of the entities that have been deleted.
 * @param {!function()} callback The success callback.
 * @param {Object=} handler The context to use when calling the callback.
 */
picnet.data.LocalDataProvider.prototype.saveDeletedEntities =
    function(type, ids, callback, handler) {
  var posids = goog.array.filter(ids, function(t) { return t > 0; });
  if (posids.length <= 0) {
    callback.call(handler || this);
    return;
  }
  this.repository.saveList('DeletedIDs|' + type, posids, function(success) {
    callback.call(handler || this, success ? [] : [{Errors: 'Unknown Error'}]);
  }, this);
};


/**
 * @private
 * @param {!picnet.data.IEntity} entity The entity to set local
 *    (disconnected) ID.
 */
picnet.data.LocalDataProvider.prototype.setValidEntityIDPreSave_ =
    function(entity) {
  if (entity.ID) return;
  entity.ID = picnet.data.LocalDataProvider.getRandomNegativeID();
};


/**
 * @return {number} A random negative ID (guranteed unique).
 */
picnet.data.LocalDataProvider.getRandomNegativeID = function() {
  return -(new Date().getTime() +
      picnet.data.LocalDataProvider.prototype.localSaveEntityIndex_++);
};


/**
 * @param {!function(Object.<string, Array.<Object>>)} callback The
 *    success callback.
 * @param {Object=} handler The context to use when calling the callback.
 */
picnet.data.LocalDataProvider.prototype.getAllUnsavedEntities =
    function(callback, handler) {
  this.repository.getLists('UnsavedEntities', callback, handler);
};


/**
 * @param {!function(Object.<string, Array.<number>>)} callback The success
 *    callback.
 * @param {Object=} handler The context to use when calling the callback.
 */
picnet.data.LocalDataProvider.prototype.getAllDeletedEntities =
    function(callback, handler) {
  this.repository.getLists('DeletedIDs', callback, handler);
};


/**
 * @param {!function()} callback The success callback.
 * @param {Object=} handler The context to use when calling the callback.
 */
picnet.data.LocalDataProvider.prototype.resetLocalChanges =
    function(callback, handler) {
  this.repository.deleteList('UnsavedEntities', function() {
    this.repository.deleteList('DeletedIDs', callback, handler);
  }, this);
};


/**
 * @param {string} type The type of the local data to update.
 * @param {!Object} data The local data to update.
 * @param {!function(boolean)} callback The success callback.
 * @param {Object=} handler The context to use when calling the callback.
 */
picnet.data.LocalDataProvider.prototype.updateLocalData =
    function(type, data, callback, handler) {
  if (data['Data'] && data['Results']) { // Append imports data
    if (data['Data'].length === 0) {
      callback.call(handler || this, true);
      return;
    }
    this.repository.getList(type, function(list) {
      this.repository.saveList(type,
          list.concat(data['Data']), callback, handler);
    }, this);
    this.repository.saveList(type, data['Data'], callback, handler);
  // This is a getEntities result, replace list
  } else if (picnet.Utils.isArray(data)) {
    this.repository.saveList(type, /** @type {!Array} */ (data),
        callback, handler);
  } else {  // Others
    var isdelete = typeof data === 'number' || !isNaN(parseInt(data, 10));
    if (isdelete) { this.repository.deleteItem(type, /** @type {number} */
        (data), callback, handler); }
    else { this.repository.saveItem(type, /** @type {!picnet.data.IEntity} */
        (data), callback, handler); }
  }
};


/**
 * @param {!function()} callback The success callback.
 * @param {Object=} handler The context to use when calling the callback.
 */
picnet.data.LocalDataProvider.prototype.clearEntireDatabase =
    function(callback, handler) {
  this.repository.clearEntireDatabase(callback, handler);
};


/**
 * For testing only
 * @private
 * @param {!Array.<string>} types The types supported by this repository.
 * @param {!function()} callback The success callback.
 * @param {Object=} handler The context to use when calling the callback.
 */
picnet.data.LocalDataProvider.prototype.reset_ =
    function(types, callback, handler) {
  this.repository.init(types, callback, handler);
};


/** @inheritDoc */
picnet.data.LocalDataProvider.prototype.disposeInternal = function() {
  picnet.data.LocalDataProvider.superClass_.disposeInternal.call(this);

  goog.dispose(this.repository);
};
