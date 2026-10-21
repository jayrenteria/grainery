import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeAttributes } from '@tiptap/react';

test('TipTap attribute merging does not inherit executable attributes from JSON', () => {
  const untrusted = JSON.parse(
    '{"__proto__":{"src":"https://attacker.invalid/image","onerror":"alert(1)"},"class":"safe"}'
  );
  const attributes = mergeAttributes(untrusted);

  assert.equal(Object.getPrototypeOf(attributes), Object.prototype);
  assert.equal(attributes.class, 'safe');
  assert.equal(attributes.src, undefined);
  assert.equal(attributes.onerror, undefined);
  const keys = [];
  for (const key in attributes) keys.push(key);
  assert.ok(!keys.includes('src'));
  assert.ok(!keys.includes('onerror'));
});
