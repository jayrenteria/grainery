import type { UIControlStateContext } from './types';

export type WhenContextMap = Record<string, boolean>;

interface Token {
  type: 'ident' | 'and' | 'or' | 'not' | 'lparen' | 'rparen' | 'eof';
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

    if (ch === '!') {
      this.index += 1;
      return { type: 'not' };
    }
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
    if (ch === '|' && this.input[this.index + 1] === '|') {
      this.index += 2;
      return { type: 'or' };
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
    return result;
  }

  private parseOr(context: WhenContextMap): boolean {
    let left = this.parseAnd(context);
    while (this.lookahead.type === 'or') {
      this.consume('or');
      const right = this.parseAnd(context);
      left = left || right;
    }
    return left;
  }

  private parseAnd(context: WhenContextMap): boolean {
    let left = this.parseUnary(context);
    while (this.lookahead.type === 'and') {
      this.consume('and');
      const right = this.parseUnary(context);
      left = left && right;
    }
    return left;
  }

  private parseUnary(context: WhenContextMap): boolean {
    if (this.lookahead.type === 'not') {
      this.consume('not');
      return !this.parseUnary(context);
    }
    return this.parsePrimary(context);
  }

  private parsePrimary(context: WhenContextMap): boolean {
    if (this.lookahead.type === 'lparen') {
      this.consume('lparen');
      const value = this.parseOr(context);
      this.consume('rparen');
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
      return Boolean(context[key]);
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
    'editor.isCurrentEmpty': Boolean(context.isCurrentEmpty),
    'editor.element.sceneHeading': current === 'sceneHeading',
    'editor.element.action': current === 'action',
    'editor.element.character': current === 'character',
    'editor.element.dialogue': current === 'dialogue',
    'editor.element.parenthetical': current === 'parenthetical',
    'editor.element.transition': current === 'transition',
    'plugin.enabled': pluginEnabled,
  };
}
