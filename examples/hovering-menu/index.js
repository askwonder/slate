
import { Editor, Raw, Plain, Selection } from '../..'
import Portal from 'react-portal'
import React from 'react'
import initialState from './state.json'
import citations from './citations.json'
import { requestSpellCheck } from './spell-check'
import { debounce, negate } from 'lodash';

const DEFAULT_NODE = 'paragraph'

const SPELL_CHECK_WAIT_TIME_MS = 3000;
const SPELL_CHECK_MAX_WAIT_TIME_MS = 30000;

const ignoreSuggestion = ({ rule: { id } }) => id === "EN_QUOTES";

const typeIs = (query) => ({ type }) => type === query;
const typeIsOffset = typeIs('offset');
const typeIsSpelling = typeIs('spelling');

const addX = (x) => (y) => x + y;
const add1 = addX(1);
const sub1 = addX(-1);

const matchesErrorMark = (op, m1) => (m2) => {
  const p1 = m1.data.get('position');
  const p2 = m2.data.get('position');
  const c1 = m1.data.get('message');
  const c2 = m2.data.get('message');
  return c1 === c2 && op(p1) === p2;
};

const isSameError = (chars, position, mark, op) => {
  const character = chars.get(position);
  if (!character) {
    return false;
  }
  return character.marks.some(matchesErrorMark(op, mark));
};

const ignoredError = (chars, offset, length, suggestion) => {
  const character = chars.get(offset);
  return character.marks.filter(typeIsSpelling).reduce((memo, mark) => {
    return memo || (
      mark.data.get('message') === suggestion.message &&
      mark.data.get('ignored')
    );
  }, false);
};

const removeSpellingSuggestion = (transform, key, chars, offset, position, length, mark) => {
  const base = offset - position;

  for (let i = 0; i < length; i++) {
    const character = chars.get(base + i);
    if (character) {
      const remove = character.marks.filter(matchesErrorMark(addX(i - position), mark)).first();
      if (remove) {
        transform.removeMarkByKey(key, base + i, 1, remove);
      }
    }
  }
};

const unchanged = (characters, currOffset, offset, length) => {
  for (let i = 1; i < length; i++) {
    const character = characters.get(currOffset + i);
    if (!character) {
      return false;
    }
    const mark = character.marks.filter(typeIsOffset).first();
    if (!mark || (mark.data.get('offset') !== offset + i)) {
      return false;
    }
  }
  return true;
};

const addSpellingSuggestion = (key, suggestion, chars, currOffset, transform) => {
  const length = Math.min(suggestion.length, chars.size - currOffset);

  for (let i = 0; i < length; i++) {
    const mark = {
      type: 'spelling',
      data: {
        length,
        position: i,
        message: suggestion.message,
        shortMessage: suggestion.shortMessage,
        replacements: suggestion.replacements,
        rule: suggestion.rule,
        ignored: false,
      },
    };
    transform.addMarkByKey(key, currOffset + i, 1, mark);
  }
};

const removeUnignoredSpellingMarks = (transform, key, offset, character) => {
  character.marks.filter(typeIsSpelling).forEach((mark) => {
    if (!mark.data.get('ignored')) {
      transform.removeMarkByKey(key, offset, 1, mark);
    }
  });
};

/**
 * Define a schema.
 *
 * @type {Object}
 */

const schema = {
  nodes: {
    'heading-one': props => <h2 {...props.attributes}>{props.children}</h2>,
    citation: (props) => {
      const { data } = props.node;
      const citation = data.get('citation');
      const { url, title } = citation;

      // Citation hover stuff
      // const showCitationInfo = data.get('showCitationInfo');
      // const unshowCitationInfo = data.get('unshowCitationInfo');
      // const onHover = () => showCitationInfo(citation);
      // const offHover = () => unshowCitationInfo(citation);
      // onMouseOver={onHover} onMouseLeave={offHover}

      return (
        <a
          {...props.attributes}
          className="citation"
          href={url}
          title={title}
        >
          {props.children}
        </a>
      );
    }
  },
  marks: {
    bold: props => <strong>{props.children}</strong>,
    code: props => <code>{props.children}</code>,
    italic: props => <em>{props.children}</em>,
    underlined: props => <u>{props.children}</u>,
    spelling: props => {
      const { data } = props.mark;
      const isIgnored = data.get('ignored');
      if (isIgnored) {
        return <span>{props.children}</span>;
      }

      const { issueType, id } = data.get('rule');

      return (
        <span className={`spelling-error spelling-error-${id}`}>
          {props.children}
        </span>
      );
    }
  }
}

/**
 * The hovering menu example.
 *
 * @type {Component}
 */

class HoveringMenu extends React.Component {

  _request = null;
  editor = null;

  /**
   * Deserialize the raw initial state.
   *
   * @type {Object}
   */

  state = {
    menu: null,
    showCitationTool: false,
    spellChecker: null,
    state: Raw.deserialize(initialState, { terse: true }),
    suggestionOnDisplay: null,
  };

  /**
   * On update, update the menu.
   */

  componentDidMount = () => {
    this.updateSpellCheckerMenu()
  }

  componentDidUpdate = () => {
    this.updateSpellCheckerMenu()
  }

  /**
   * Check if the current selection has a mark with `type` in it.
   *
   * @param {String} type
   * @return {Boolean}
   */

  hasMark = (type) => {
    const { state } = this.state
    return state.marks.some(mark => mark.type == type)
  }

  /**
   * On change, save the new state.
   *
   * @param {State} state
   */

  onChange = (state) => {
    this.setState({ state });

    setTimeout(() => {
      this.debouncedSpellCheck();
      this.maybeSelectError();
      this.removeStaleSuggestions();
    });
  }

  removeStaleSuggestions = () => {
    let { state } = this.state;
    const transform = state.transform();

    state.document.getTextsAsArray().forEach((text) => {
      text.characters.forEach((character, offset, chars) => {
        const mark = character.marks.filter(typeIsSpelling).first();
        if (mark) {
          const length = mark.data.get('length');
          const position = mark.data.get('position');
          if ((position + 1 < length && !isSameError(chars, offset + 1, mark, add1)) ||
              (position > 0 && !isSameError(chars, offset - 1, mark, sub1))) {
            removeSpellingSuggestion(transform, text.key, chars, offset, position, length, mark);
          }
        }
      });
    });


    state = transform.apply(false);
    this.setState({ state });
  }

  spellCheck = async () => {
    const text = Plain.serialize(this.state.state);
    let suggestions;

    this.addCharacterOffsetMarks();

    try {
      this._request = requestSpellCheck(text);
      suggestions = await this._request;
    } finally {
      this._request = null;
    }

    this.markSpellCheckSuggestions(suggestions);
  }

  addCharacterOffsetMarks = () => {
    let { state } = this.state;
    let offset = 0;
    const transform = state.transform();

    state.document.nodes.forEach((node) => {
      node.getTextsAsArray().forEach((text) => {
        text.characters.forEach((character, currOffset) => {
          const newMark = { type: 'offset', data: { offset } };
          transform.addMarkByKey(text.key, currOffset, 1, newMark);
          offset = offset + 1;
        });
      });
      offset = offset + 1;
    });

    state = transform.apply(false);
    this.setState({ state });
  }

  markSpellCheckSuggestions = (suggestions) => {
    let { state } = this.state;
    const transform = state.transform();

    // remove offset marks
    state.document.getTextsAsArray().forEach((text) => {
      text.characters.forEach((character, currOffset) => {
        const mark = character.marks.filter(typeIsOffset).first();
        if (mark) {
          transform.removeMarkByKey(text.key, currOffset, 1, mark);
        }
      });
    });

    // highlight suggestions
    suggestions
    .filter(negate(ignoreSuggestion))
    .forEach((suggestion) => {
      state.document.getTextsAsArray().forEach((text) => {
        const chars = text.characters;
        chars.forEach((character, currOffset) => {
          removeUnignoredSpellingMarks(transform, text.key, currOffset, character);

          const mark = character.marks.filter(typeIsOffset).first();
          if (mark && (mark.data.get('offset') === suggestion.offset) &&
              unchanged(chars, currOffset, mark.data.get('offset'), suggestion.length) &&
              !ignoredError(chars, currOffset, suggestion.length, suggestion)) {
            addSpellingSuggestion(text.key, suggestion, chars, currOffset, transform);
          }
        });
      });
    });

    state = transform.apply(false);
    this.setState({ state });
  }

  maybeSpellCheck = () => {
    if (!this._request) {
      this.spellCheck();
    } else {
      // Request could be taking longer than the SPELL_CHECK_WAIT_TIME_MS so we
      // can queue up another request to take place after
      // SPELL_CHECK_WAIT_TIME_MS
      this.debouncedSpellCheck();
    }
  }

  debouncedSpellCheck = debounce(
    () => this.maybeSpellCheck(),
    SPELL_CHECK_WAIT_TIME_MS,
    { maxWait: SPELL_CHECK_MAX_WAIT_TIME_MS }
  );

  /**
   * When a mark button is clicked, toggle the current mark.
   *
   * @param {Event} e
   * @param {String} type
   */

  onClickMark = (e, type) => {
    e.preventDefault()
    let { state } = this.state

    state = state
      .transform()
      .toggleMark(type)
      .apply()

    this.setState({ state })
  }

  /**
   * When the portal opens, cache the menu element.
   *
   * @param {Element} portal
   */

  onOpen = (portal) => {
    this.setState({ menu: portal.firstChild })
  }

  onOpenSpellChecker = (portal) => {
    this.setState({ spellChecker: portal.firstChild })
  }

  /**
   * Render.
   *
   * @return {Element}
   */

  render = () => {
    // Citation overlay stuff
    // {this.renderCitationInfo()}

    return (
      <div>
        {this.renderMenu()}
        {this.renderSpellChecker()}
        {this.renderCitationTool()}
        {this.renderToolbar()}
        {this.renderEditor()}
      </div>
    )
  }

  // Citation overlay stuff
  // showCitationInfo = (citation) => {
  //   this.setState({ showCitationInfo: citation });
  // }

  // unshowCitationInfo = (citation) => {
  //   this.setState({ showCitationInfo: null });
  // }

  onClickCitation = (e, citation) => {
    let { state } = this.state

    state = state
      .transform()
      .wrapInline({
        type: 'citation',
        data: {
          citation,
          // Citation overlay stuff
          // showCitationInfo: this.showCitationInfo,
          // unshowCitationInfo: this.unshowCitationInfo,
        }
      })
      .collapseToEnd()
      .focus()
      .apply()

    this.setState({
      showCitationTool: false,
      state,
    })
  }

  renderCitationChoice = (citation, i) => {
    const onClick = (e) => {
      e.preventDefault()
      this.onClickCitation(e, citation)
    }

    return (
      <li key={i}>
        <a onClick={onClick} href={citation.url}>
          {citation.domain} - { citation.title}
        </a>
      </li>
    )
  }

  onCitationToolClose = () => {
    this.setState({ showCitationTool: false })
  }

  /**
   * Render the citation tool.
   *
   * @return {Element}
   */

  renderCitationTool = () => {
    const { showCitationTool } = this.state
    return (
      <Portal
        closeOnEsc
        closeOnOutsideClick
        isOpened={showCitationTool}
        onClose={this.onCitationToolClose}
      >
        <div className="citation-hover-menu">
          <strong>Choose Citation</strong>
          <ul>
            {citations.map(this.renderCitationChoice)}
          </ul>
        </div>
      </Portal>
    )
  }

  /**
   * Render the hovering menu.
   *
   * @return {Element}
   */

  renderMenu = () => {
    return (
      <Portal isOpened onOpen={this.onOpen}>
        <div className="menu hover-menu">
          {this.renderMarkButton('bold', 'format_bold')}
          {this.renderMarkButton('italic', 'format_italic')}
          {this.renderMarkButton('underlined', 'format_underlined')}
          {this.renderMarkButton('code', 'code')}
        </div>
      </Portal>
    )
  }

  onClickReplacement = (e, value) => {
    let { state } = this.state
    const { anchorOffset, anchorKey } = state.selection
    const newOffset = anchorOffset + value.length
    const selection = Selection.create({
      anchorKey,
      anchorOffset: newOffset,
      focusKey: anchorKey,
      focusOffset: newOffset,
    })

    state = state
      .transform()
      .delete()
      .insertText(value)
      .select(selection)
      .apply()

    this.setState({
      state,
      suggestionOnDisplay: null
    }, () => {
      setTimeout(() => this.editor.focus(), 0)
    })
  }

  onIgnoreSuggestion = (e) => {
    const { state, suggestionOnDisplay } = this.state
    const { anchorKey: key, anchorOffset: base } = state.selection
    const characters = state.document.getDescendant(key).characters
    const transform = state.transform()
    const length = suggestionOnDisplay.data.get('length')
    const position = suggestionOnDisplay.data.get('position')
    const newOffset = base + length
    const selection = Selection.create({
      anchorKey: key,
      anchorOffset: newOffset,
      focusKey: key,
      focusOffset: newOffset,
    })

    for (let i = 0; i < length; i++) {
      const character = characters.get(base + i)
      const remove = character.marks.filter(matchesErrorMark(addX(i - position), suggestionOnDisplay)).first()
      const newData = remove.data.set('ignored', true)
      const replace = remove.set('data', newData)
      transform.removeMarkByKey(key, base + i, 1, remove)
      transform.addMarkByKey(key, base + i, 1, replace)
    }

    transform.select(selection)

    this.setState({
      state: transform.apply(),
      suggestionOnDisplay: null
    }, () => {
      setTimeout(() => this.editor.focus(), 0)
    })
  }

  renderReplacement = ({ value }) => {
    const onMouseDown = e => this.onClickReplacement(e, value)

    return (
      <li key={value} onMouseDown={onMouseDown}>{value}</li>
    )
  }

  renderSuggestionOnDisplay = () => {
    const { suggestionOnDisplay } = this.state
    if (!suggestionOnDisplay) {
      return null
    }

    const replacements = suggestionOnDisplay.data.get('replacements');
    const onMouseDown = (e) => this.onIgnoreSuggestion(e);
    const replacementsList = replacements.length === 0 ? null : (
      <ul className="suggestion-box-replacements">
        {replacements.map(this.renderReplacement)}
      </ul>
    );

    return (
      <div className="suggestion-box">
        <div className="suggestion-box-header">
          {suggestionOnDisplay.data.get('message')}
        </div>
        {replacementsList}
        <div onMouseDown={onMouseDown} className="suggestion-box-ignore">
          Ignore
        </div>
      </div>
    );
  }

  renderSpellChecker = () => {
    return (
      <Portal isOpened onOpen={this.onOpenSpellChecker}>
        <div className="menu hover-menu">
          {this.renderSuggestionOnDisplay()}
        </div>
      </Portal>
    )
  }

  // renderCitationInfo = () => {
  //   const { showCitationInfo } = this.state;

  //   return (
  //     <Portal isOpened={!!showCitationInfo}>
  //       <div className="menu hover-menu">
  //         {this.renderCitationOnDisplay()}
  //       </div>
  //     </Portal>
  //   )
  // }

  // renderCitationOnDisplay = () => {
  //   const { showCitationInfo } = this.state;

  //   return (
  //     <div>
  //     </div>
  //   );
  // }

  /**
   * Render a mark-toggling toolbar button.
   *
   * @param {String} type
   * @param {String} icon
   * @return {Element}
   */

  renderMarkButton = (type, icon) => {
    const isActive = this.hasMark(type)
    const onMouseDown = e => this.onClickMark(e, type)

    return (
      <span className="button" onMouseDown={onMouseDown} data-active={isActive}>
        <span className="material-icons">{icon}</span>
      </span>
    )
  }

  /**
   * Render the Slate editor.
   *
   * @return {Element}
   */

  renderEditor = () => {
    const setEditorRef = (ref) => this.editor = ref;

    return (
      <div className="editor">
        <Editor
          schema={schema}
          ref={setEditorRef}
          state={this.state.state}
          onChange={this.onChange}
          spellCheck={false}
        />
      </div>
    )
  }

  /**
   * Update the menu's absolute position.
   */

  maybeSelectError = () => {
    const { state, suggestionOnDisplay } = this.state;
    const { anchorKey, anchorOffset, focusKey, focusOffset, isCollapsed, isBackward } = state.selection;

    const shouldCloseSpellChecker = (
      state.isBlurred ||
      isBackward ||
      focusKey !== anchorKey ||
      (suggestionOnDisplay && isCollapsed)
    );
    if (shouldCloseSpellChecker) {
      this.setState({ suggestionOnDisplay: null });
      return;
    }

    const length = focusOffset - anchorOffset;
    const text = state.document.getDescendant(anchorKey);
    const character = text.characters.get(anchorOffset);
    if (!character) {
      this.setState({ suggestionOnDisplay: null });
      return;
    }
    const suggestions = character.marks.filter(typeIsSpelling);
    if (suggestions.size === 0) {
      this.setState({ suggestionOnDisplay: null });
      return;
    }

    if (length === 0) {
      const suggestion = suggestions.first();
      if (suggestion.data.get('ignored')) {
        return;
      }

      const transform = state.transform();
      const newAnchorOffset = anchorOffset - suggestion.data.get('position');
      const newFocusOffset = newAnchorOffset + suggestion.data.get('length');
      const newState = transform
        .moveOffsetsTo(newAnchorOffset, newFocusOffset)
        .apply(false);
      this.setState({ state: newState, suggestionOnDisplay: suggestion });
      return;
    }

    const suggestion = suggestions
      .filter((mark) => mark.data.get('position') === 0)
      .filter((mark) => mark.data.get('length') === length)
      .first();
    if (!suggestion) {
      this.setState({ suggestionOnDisplay: null });
    }
  }

  updateSpellCheckerMenu = () => {
    const { spellChecker, suggestionOnDisplay } = this.state
    if (!spellChecker) return

    if (!suggestionOnDisplay) {
      spellChecker.removeAttribute('style')
      return
    }

    let range;
    try {
      const selection = window.getSelection();
      range = selection.getRangeAt(0);
    } catch (e) {
      return;
    }

    const rect = range.getBoundingClientRect()
    spellChecker.style.opacity = 1
    spellChecker.style.top = `${rect.bottom + window.scrollY + 5}px`
    spellChecker.style.left = `${rect.left + window.scrollX}px`
  }

  /**
   * When a block button is clicked, toggle the block type.
   *
   * @param {Event} e
   * @param {String} type
   */

  onClickBlock = (e, type) => {
    e.preventDefault()
    let { state } = this.state
    const transform = state.transform()
    const { document } = state

    // Handle everything but list buttons.
    const isActive = this.hasBlock(type)
    transform
      .setBlock(isActive ? DEFAULT_NODE : type)

    state = transform.apply()
    this.setState({ state })
  }

  /**
   * Check if the any of the currently selected blocks are of `type`.
   *
   * @param {String} type
   * @return {Boolean}
   */

  hasBlock = (type) => {
    const { state } = this.state
    return state.blocks.some(node => node.type == type)
  }

  /**
   * Render a block-toggling toolbar button.
   *
   * @param {String} type
   * @param {String} icon
   * @return {Element}
   */

  renderBlockButton = (type, icon) => {
    const isActive = this.hasBlock(type)
    const onMouseDown = e => this.onClickBlock(e, type)

    return (
      <span className="button" onMouseDown={onMouseDown} data-active={isActive}>
        <span className="material-icons">{icon}</span>
      </span>
    )
  }

  /**
   * Render a mark-toggling toolbar button.
   *
   * @param {String} type
   * @param {String} icon
   * @return {Element}
   */

  renderMarkButton = (type, icon) => {
    const isActive = this.hasMark(type)
    const onMouseDown = e => this.onClickMark(e, type)

    return (
      <span className="button" onMouseDown={onMouseDown} data-active={isActive}>
        <span className="material-icons">{icon}</span>
      </span>
    )
  }

  /**
   * Render the toolbar.
   *
   * @return {Element}
   */

  renderToolbar = () => {
    return (
      <div className="menu toolbar-menu">
        {this.renderBlockButton('heading-one', 'title')}
        {this.renderCiteButton()}
      </div>
    )
  }

  /**
   * Check whether the current selection has a citation in it.
   *
   * @return {Boolean} hasCitations
   */

  hasCitations = () => {
    const { state } = this.state
    return state.inlines.some(inline => inline.type == 'citation')
  }

  onCite = (e) => {
    e.preventDefault()
    let { state } = this.state;
    const transform = state.transform();
    const hasCitations = this.hasCitations();

    if (hasCitations) {
      state = state
        .transform()
        .unwrapInline('citation')
        .collapseToEnd()
        .focus()
        .apply();
      this.setState({ state });
    } else {
      this.setState({ showCitationTool: true });
    }
  }

  renderCiteButton = () => {
    const isActive = this.hasMark('citation')
    return (
      <span className="button" onClick={this.onCite} data-active={isActive}>
        <span className="material-icons">link</span>
      </span>
    )
  }
}

/**
 * Export.
 */

export default HoveringMenu
