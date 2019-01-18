'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _getWindow = require('get-window');

var _getWindow2 = _interopRequireDefault(_getWindow);

var _offsetKey = require('./offset-key');

var _offsetKey2 = _interopRequireDefault(_offsetKey);

var _normalizeNodeAndOffset = require('./normalize-node-and-offset');

var _normalizeNodeAndOffset2 = _interopRequireDefault(_normalizeNodeAndOffset);

var _findClosestNode = require('./find-closest-node');

var _findClosestNode2 = _interopRequireDefault(_findClosestNode);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/**
 * Constants.
 *
 * @type {String}
 */

var OFFSET_KEY_ATTRIBUTE = 'data-offset-key';
var RANGE_SELECTOR = '[' + OFFSET_KEY_ATTRIBUTE + ']';
var TEXT_SELECTOR = '[data-key]';
var VOID_SELECTOR = '[data-slate-void]';

/**
 * Find a Slate point from a DOM selection's `nativeNode` and `nativeOffset`.
 *
 * @param {Element} nativeNode
 * @param {Number} nativeOffset
 * @param {State} state
 * @return {Object}
 */

function findPoint(nativeNode, nativeOffset, state) {
  var _normalizeNodeAndOffs = (0, _normalizeNodeAndOffset2.default)(nativeNode, nativeOffset),
      nearestNode = _normalizeNodeAndOffs.node,
      nearestOffset = _normalizeNodeAndOffs.offset;

  var window = (0, _getWindow2.default)(nativeNode);
  var parentNode = nearestNode.parentNode;

  var rangeNode = (0, _findClosestNode2.default)(parentNode, RANGE_SELECTOR);
  var offset = void 0;
  var node = void 0;

  // Calculate how far into the text node the `nearestNode` is, so that we can
  // determine what the offset relative to the text node is.
  if (rangeNode) {
    var range = window.document.createRange();
    var textNode = (0, _findClosestNode2.default)(rangeNode, TEXT_SELECTOR);
    range.setStart(textNode, 0);
    range.setEnd(nearestNode, nearestOffset);
    node = textNode;
    offset = range.toString().length;
  }

  // For void nodes, the element with the offset key will be a cousin, not an
  // ancestor, so find it by going down from the nearest void parent.
  else {
      var voidNode = (0, _findClosestNode2.default)(parentNode, VOID_SELECTOR);
      if (!voidNode) return null;
      rangeNode = voidNode.querySelector(RANGE_SELECTOR);
      node = rangeNode;
      offset = node.textContent.length;
    }

  // Get the string value of the offset key attribute.
  var offsetKey = rangeNode.getAttribute(OFFSET_KEY_ATTRIBUTE);
  if (!offsetKey) return null;

  var _OffsetKey$parse = _offsetKey2.default.parse(offsetKey),
      key = _OffsetKey$parse.key;

  // COMPAT: If someone is clicking from one Slate editor into another, the
  // select event fires twice, once for the old editor's `element` first, and
  // then afterwards for the correct `element`. (2017/03/03)


  if (!state.document.hasDescendant(key)) return null;

  return {
    key: key,
    offset: offset
  };
}

/**
 * Export.
 *
 * @type {Function}
 */

exports.default = findPoint;