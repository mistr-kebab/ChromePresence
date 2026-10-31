import test from 'node:test';
import assert from 'node:assert/strict';

import {
  displayHost,
  isExcluded,
  isWebUrl,
  matchesDomain,
  normalizeDomainPattern,
  sanitizeDomainList,
} from '../src/shared/domain.js';

test('normalizes typed domains, URLs, ports and wildcards', () => {
  assert.equal(normalizeDomainPattern('  Example.COM '), 'example.com');
  assert.equal(normalizeDomainPattern('https://example.com/path?q=1'), 'example.com');
  assert.equal(normalizeDomainPattern('*.Example.com'), 'example.com');
  assert.equal(normalizeDomainPattern('example.com:8443'), 'example.com');
  assert.equal(normalizeDomainPattern('example.com.'), 'example.com');
  assert.equal(normalizeDomainPattern('münchen.de'), 'xn--mnchen-3ya.de');
  assert.equal(normalizeDomainPattern('not a domain!'), '');
  assert.equal(normalizeDomainPattern(''), '');
});

test('matches a domain and its subdomains without suffix traps', () => {
  assert.equal(matchesDomain('example.com', 'example.com'), true);
  assert.equal(matchesDomain('www.example.com', 'example.com'), true);
  assert.equal(matchesDomain('a.b.example.com', '*.example.com'), true);
  assert.equal(matchesDomain('notexample.com', 'example.com'), false);
  assert.equal(matchesDomain('example.com.evil.test', 'example.com'), false);
  assert.equal(matchesDomain('other.com', 'example.com'), false);
});

test('isExcluded accepts mixed lists', () => {
  const patterns = ['example.com', 'https://bank.de/login', '*.internal.test'];
  assert.equal(isExcluded('www.example.com', patterns), true);
  assert.equal(isExcluded('bank.de', patterns), true);
  assert.equal(isExcluded('foo.internal.test', patterns), true);
  assert.equal(isExcluded('unrelated.test', patterns), false);
  assert.equal(isExcluded('example.com', []), false);
});

test('displayHost removes www only when a registrable-looking host remains', () => {
  assert.equal(displayHost('www.youtube.com'), 'youtube.com');
  assert.equal(displayHost('www.com'), 'www.com');
  assert.equal(displayHost('sub.example.com'), 'sub.example.com');
});

test('isWebUrl only accepts http and https', () => {
  assert.equal(isWebUrl('https://example.com'), true);
  assert.equal(isWebUrl('http://example.com'), true);
  assert.equal(isWebUrl('chrome://newtab'), false);
  assert.equal(isWebUrl('file:///tmp/test.html'), false);
  assert.equal(isWebUrl('not a url'), false);
});

test('sanitizeDomainList trims, deduplicates and drops invalid entries', () => {
  assert.deepEqual(
    sanitizeDomainList([
      'Example.com',
      'https://www.example.com/foo',
      ' example.com ',
      'bad domain!',
      'münchen.de',
    ]),
    ['example.com', 'www.example.com', 'xn--mnchen-3ya.de'],
  );
});
