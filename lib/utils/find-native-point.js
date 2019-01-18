'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _getWindow = require('get-window');

var _getWindow2 = _interopRequireDefault(_getWindow);

var _findDomNode = require('./find-dom-node');

var _findDomNode2 = _interopRequireDefault(_findDomNode);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/**
 * Find a native DOM selection point from a Slate `key` and `offset`.
 *
 * @param {Element} root
 * @param {String} key
 * @param {Number} offset
 * @return {Object}
 */

function findNativePoint(key, offset) {
  var el = (0, _findDomNode2.default)(key);
  if (!el) return null;

  var window = (0, _getWindow2.default)(el);
  var iterator = window.document.createNodeIterator(el, NodeFilter.SHOW_TEXT);
  var start = 0;
  var n = void 0;

  while (n = iterator.nextNode()) {
    var length = n.textContent.length;

    var end = start + length;

    if (offset <= end) {
      var o = offset - start;
      return { node: n, offset: o };
    }

    start = end;
  }

  // COMPAT: For empty blocks with only a single empty text node, we will have
  // rendered a `<br/>` instead of a text node.
  if (el.childNodes.length == 1 && el.childNodes[0].childNodes.length == 1 && el.childNodes[0].childNodes[0].tagName == 'BR') {
    return { node: el.childNodes[0], offset: 0 };
  }

  return null;
}

/**
 * Export.
 *
 * @type {Function}
 */

exports.default = findNativePoint;