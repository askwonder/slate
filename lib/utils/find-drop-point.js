'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _getWindow = require('get-window');

var _getWindow2 = _interopRequireDefault(_getWindow);

var _findClosestNode = require('./find-closest-node');

var _findClosestNode2 = _interopRequireDefault(_findClosestNode);

var _findPoint = require('./find-point');

var _findPoint2 = _interopRequireDefault(_findPoint);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/**
 * Find the target point for a drop `event`.
 *
 * @param {Event} event
 * @param {State} state
 * @return {Object}
 */

function findDropPoint(event, state) {
  var document = state.document;
  var nativeEvent = event.nativeEvent,
      target = event.target;
  var x = nativeEvent.x,
      y = nativeEvent.y;

  // Resolve the caret position where the drop occured.

  var window = (0, _getWindow2.default)(target);
  var n = void 0,
      o = void 0;

  // COMPAT: In Firefox, `caretRangeFromPoint` doesn't exist. (2016/07/25)
  if (window.document.caretRangeFromPoint) {
    var range = window.document.caretRangeFromPoint(x, y);
    n = range.startContainer;
    o = range.startOffset;
  } else {
    var position = window.document.caretPositionFromPoint(x, y);
    n = position.offsetNode;
    o = position.offset;
  }

  var nodeEl = (0, _findClosestNode2.default)(n, '[data-key]');
  var nodeKey = nodeEl.getAttribute('data-key');
  var node = document.key === nodeKey ? document : document.getDescendant(nodeKey);

  // If the drop DOM target is inside an inline void node use last position of
  // the previous sibling text node or first position of the next sibling text
  // node as Slate target.
  if (node.isVoid && node.kind === 'inline') {
    var rect = nodeEl.getBoundingClientRect();
    var previous = x - rect.left < rect.left + rect.width - x;
    var text = previous ? document.getPreviousSibling(nodeKey) : document.getNextSibling(nodeKey);
    var key = text.key;
    var offset = previous ? text.characters.size : 0;
    return { key: key, offset: offset };
  }

  // If the drop DOM target is inside a block void node use last position of
  // the previous sibling block node or first position of the next sibling block
  // node as Slate target.
  if (node.isVoid) {
    var _rect = nodeEl.getBoundingClientRect();
    var _previous = y - _rect.top < _rect.top + _rect.height - y;

    if (_previous) {
      var _block = document.getPreviousBlock(nodeKey);
      var _text2 = _block.getLastText();
      var _key2 = _text2.key;

      var _offset2 = _text2.characters.size;
      return { key: _key2, offset: _offset2 };
    }

    var block = document.getNextBlock(nodeKey);
    var _text = block.getLastText();
    var _key = _text.key;

    var _offset = 0;
    return { key: _key, offset: _offset };
  }

  var point = (0, _findPoint2.default)(n, o, state);
  return point;
}

/**
 * Export.
 *
 * @type {Function}
 */

exports.default = findDropPoint;