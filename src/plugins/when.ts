import type { UIControlStateContext } from './types';

export type WhenContextValue = boolean | string | number | null | undefined;
export type WhenContextMap = Record<string, WhenContextValue>;

interface Token {
  type: 'ident' | 'string' | 'and' | 'or' | 'not' | 'eq' | 'neq' | 'lparen' | 'rparen' | 'eof';
  value?: string;
}

class Lexer {
  private readonly input: string;
  private index = 0;

  constructor(input: string) {
    this.input = input;
  }

  next(): Token {
    this.skipWhitespace();
    if (this.index >= this.input.length) {
      return { type: 'eof' };
    }

    const ch = this.input[this.index];

    if (ch === '(') {
      this.index += 1;
      return { type: 'lparen' };
    }
    if (ch === ')') {
      this.index += 1;
      return { type: 'rparen' };
    }
    if (ch === '&' && this.input[this.index + 1] === '&') {
      this.index += 2;
      return { type: 'and' };
    }
    if (ch === '=' && this.input[this.index + 1] === '=') {
      this.index += 2;
      return { type: 'eq' };
    }
    if (ch === '!' && this.input[this.index + 1] === '=') {
      this.index += 2;
      return { type: 'neq' };
    }
    if (ch === '!') {
      this.index += 1;
      return { type: 'not' };
    }
    if (ch === '|' && this.input[this.index + 1] === '|') {
      this.index += 2;
      return { type: 'or' };
    }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      this.index += 1;
      const start = this.index;
      while (this.index < this.input.length && this.input[this.index] !== quote) {
        this.index += 1;
      }
      if (this.input[this.index] !== quote) {
        throw new Error('Unterminated string literal');
      }
      const value = this.input.slice(start, this.index);
      this.index += 1;
      return {
        type: 'string',
        value,
      };
    }

    if (/[a-zA-Z0-9_.-]/.test(ch)) {
      const start = this.index;
      this.index += 1;
      while (this.index < this.input.length && /[a-zA-Z0-9_.-]/.test(this.input[this.index])) {
        this.index += 1;
      }
      return {
        type: 'ident',
        value: this.input.slice(start, this.index),
      };
    }

    throw new Error(`Unexpected token '${ch}'`);
  }

  private skipWhitespace(): void {
    while (this.index < this.input.length && /\s/.test(this.input[this.index])) {
      this.index += 1;
    }
  }
}

class Parser {
  private readonly lexer: Lexer;
  private lookahead: Token;

  constructor(input: string) {
    this.lexer = new Lexer(input);
    this.lookahead = this.lexer.next();
  }

  parse(context: WhenContextMap): boolean {
    const result = this.parseOr(context);
    if (this.lookahead.type !== 'eof') {
      throw new Error('Unexpected trailing tokens');
    }
    return Boolean(result);
  }

  private parseOr(context: WhenContextMap): WhenContextValue {
    let left = this.parseAnd(context);
    while (this.lookahead.type === 'or') {
      this.consume('or');
      const right = this.parseAnd(context);
      left = Boolean(left) || Boolean(right);
    }
    return left;
  }

  private parseAnd(context: WhenContextMap): WhenContextValue {
    let left = this.parseEquality(context);
    while (this.lookahead.type === 'and') {
      this.consume('and');
      const right = this.parseEquality(context);
      left = Boolean(left) && Boolean(right);
    }
    return left;
  }

  private parseEquality(context: WhenContextMap): WhenContextValue {
    let left = this.parseUnary(context);
    while (this.lookahead.type === 'eq' || this.lookahead.type === 'neq') {
      const op = this.lookahead.type;
      this.consume(op);
      const right = this.parseUnary(context);
      left = op === 'eq'
        ? String(left ?? '') === String(right ?? '')
        : String(left ?? '') !== String(right ?? '');
    }
    return left;
  }

  private parseUnary(context: WhenContextMap): WhenContextValue {
    if (this.lookahead.type === 'not') {
      this.consume('not');
      return !this.parseUnary(context);
    }
    return this.parsePrimary(context);
  }

  private parsePrimary(context: WhenContextMap): WhenContextValue {
    if (this.lookahead.type === 'lparen') {
      this.consume('lparen');
      const value = this.parseOr(context);
      this.consume('rparen');
      return value;
    }

    if (this.lookahead.type === 'string') {
      const value = this.lookahead.value ?? '';
      this.consume('string');
      return value;
    }

    if (this.lookahead.type === 'ident') {
      const key = this.lookahead.value ?? '';
      this.consume('ident');
      if (key === 'true') {
        return true;
      }
      if (key === 'false') {
        return false;
      }
      return Object.prototype.hasOwnProperty.call(context, key) ? context[key] : false;
    }

    throw new Error('Expected identifier or parenthesized expression');
  }

  private consume(type: Token['type']): void {
    if (this.lookahead.type !== type) {
      throw new Error(`Expected ${type} but found ${this.lookahead.type}`);
    }
    this.lookahead = this.lexer.next();
  }
}

export function evaluateWhenClause(expression: string | undefined, context: WhenContextMap): boolean {
  if (!expression || expression.trim().length === 0) {
    return true;
  }

  try {
    const parser = new Parser(expression);
    return parser.parse(context);
  } catch {
    return false;
  }
}

export function createWhenContext(
  context: UIControlStateContext,
  pluginEnabled: boolean
): WhenContextMap {
  const hasSelection = Number.isFinite(context.selectionFrom)
    && Number.isFinite(context.selectionTo)
    && context.selectionTo > context.selectionFrom;
  const current = context.currentElementType;

  return {
    'editor.hasSelection': hasSelection,
    'editor.documentMode': context.documentMode,
    'editor.mode.screenplay': context.documentMode === 'screenplay',
    'editor.mode.comic': context.documentMode === 'comic',
    'editor.mode.freewrite': context.documentMode === 'freewrite',
    'editor.selection.empty': !hasSelection,
    'editor.isCurrentEmpty': Boolean(context.isCurrentEmpty),
    'editor.currentElement': current ?? '',
    'editor.previousElement': context.previousElementType ?? '',
    'editor.hasPreviousElement': Boolean(context.previousElementType),
    'editor.element.sceneHeading': current === 'sceneHeading',
    'editor.element.action': current === 'action',
    'editor.element.character': current === 'character',
    'editor.element.dialogue': current === 'dialogue',
    'editor.element.parenthetical': current === 'parenthetical',
    'editor.element.transition': current === 'transition',
    'editor.element.comicPage': current === 'comicPage',
    'editor.element.comicPanel': current === 'comicPanel',
    'editor.element.caption': current === 'caption',
    'editor.element.soundEffect': current === 'soundEffect',
    'editor.element.title': current === 'title',
    'editor.element.heading': current === 'heading',
    'editor.element.body': current === 'body',
    'editor.element.bulletItem': current === 'bulletItem',
    'editor.element.numberedItem': current === 'numberedItem',
    'plugin.enabled': pluginEnabled,
  };
}
