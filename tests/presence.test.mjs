import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeSettings } from '../src/shared/defaults.js';
import {
  activityKey,
  createActivity,
  truncate,
} from '../src/shared/presence.js';

const NOW = 1_700_000_000_000;

function settings(overrides = {}) {
  return normalizeSettings({
    appId: '123456789012345678',
    ...overrides,
  });
}

function tab(overrides = {}) {
  return {
    id: 7,
    title: 'An exciting video – YouTube',
    url: 'https://www.youtube.com/watch?v=abc123',
    incognito: false,
    ...overrides,
  };
}

test('builds a title, domain and elapsed time from a tab', () => {
  const built = createActivity({
    tab: tab(),
    settings: settings(),
    startedAt: NOW - 125_000,
    now: NOW,
  });

  assert.equal(built.reason, null);
  assert.equal(built.host, 'youtube.com');
  assert.equal(built.activity.details, 'An exciting video – YouTube');
  assert.equal(built.activity.state, 'youtube.com');
  assert.equal(built.activity.type, 0);
  assert.deepEqual(built.activity.timestamps, {
    start: Math.floor((NOW - 125_000) / 1000),
  });
});

test('can hide timestamps and use the domain as the first line', () => {
  const built = createActivity({
    tab: tab(),
    settings: settings({ detailsSource: 'domain', showTimestamp: false }),
    startedAt: NOW - 5000,
    now: NOW,
  });

  assert.equal(built.activity.details, 'youtube.com');
  assert.equal(built.activity.state, undefined);
  assert.equal(built.activity.timestamps, undefined);
});

test('supports path and full URL as the state line', () => {
  const path = createActivity({
    tab: tab({ url: 'https://www.youtube.com/watch?v=abc123#comments' }),
    settings: settings({ stateSource: 'path' }),
    startedAt: NOW,
    now: NOW,
  });
  assert.equal(path.activity.state, 'youtube.com/watch');

  const full = createActivity({
    tab: tab({ url: 'https://www.youtube.com/watch?v=abc123#comments' }),
    settings: settings({ stateSource: 'url' }),
    startedAt: NOW,
    now: NOW,
  });
  assert.equal(full.activity.state, 'https://www.youtube.com/watch?v=abc123#comments');
});

test('skips internal, incognito and excluded tabs', () => {
  assert.equal(
    createActivity({
      tab: tab({ url: 'chrome://newtab' }),
      settings: settings(),
      startedAt: NOW,
      now: NOW,
    }).reason,
    'internal',
  );

  assert.equal(
    createActivity({
      tab: tab({ incognito: true }),
      settings: settings(),
      startedAt: NOW,
      now: NOW,
    }).reason,
    'incognito',
  );

  const excluded = createActivity({
    tab: tab({ url: 'https://bank.example/account' }),
    settings: settings({ excludedDomains: ['bank.example'] }),
    startedAt: NOW,
    now: NOW,
  });
  assert.equal(excluded.reason, 'excluded');
  assert.equal(excluded.activity, null);
  assert.equal(excluded.host, 'bank.example');
});

test('falls back to the domain when the tab title is a URL or empty', () => {
  const empty = createActivity({
    tab: tab({ title: '' }),
    settings: settings(),
    startedAt: NOW,
    now: NOW,
  });
  assert.equal(empty.activity.details, 'youtube.com');

  const urlTitle = createActivity({
    tab: tab({ title: 'https://www.youtube.com/watch?v=abc123' }),
    settings: settings(),
    startedAt: NOW,
    now: NOW,
  });
  assert.equal(urlTitle.activity.details, 'youtube.com');
});

test('truncates Discord fields at 128 characters', () => {
  const longTitle = 'x'.repeat(300);
  const built = createActivity({
    tab: tab({ title: longTitle }),
    settings: settings(),
    startedAt: NOW,
    now: NOW,
  });
  assert.equal(Array.from(built.activity.details).length, 128);
  assert.ok(built.activity.details.endsWith('…'));

  assert.equal(truncate('  a   b  '), 'a b');
  assert.equal(Array.from(truncate('x'.repeat(130))).length, 128);
});

test('uses the website icon by default and builds asset keys', () => {
  const keyed = createActivity({
    tab: tab(),
    settings: settings({
      showSiteIcon: false,
      largeImageKey: 'chrome',
      largeText: 'Google Chrome',
      smallImageKey: 'discord',
      smallText: 'Chrome Presence',
    }),
    startedAt: NOW,
    now: NOW,
  });
  assert.deepEqual(keyed.activity.assets, {
    large_image: 'chrome',
    large_text: 'Google Chrome',
    small_image: 'discord',
    small_text: 'Chrome Presence',
  });

  const favicon = createActivity({
    tab: tab(),
    settings: settings(),
    startedAt: NOW,
    now: NOW,
  });
  assert.equal(settings().showSiteIcon, true);
  assert.match(favicon.activity.assets.large_image, /^https:\/\/www\.google\.com\//);
  assert.match(favicon.activity.assets.large_image, /youtube\.com/);
  assert.equal(favicon.activity.assets.large_text, 'youtube.com');
});

test('ignores invalid activity types and future start times', () => {
  const built = createActivity({
    tab: tab(),
    settings: settings({ activityType: 9, showTimestamp: true }),
    startedAt: NOW + 60_000,
    now: NOW,
  });
  assert.equal(built.activity.type, 0);
  assert.equal(built.activity.timestamps, undefined);
});

test('activityKey is stable for identical activities', () => {
  const first = createActivity({
    tab: tab(),
    settings: settings(),
    startedAt: NOW,
    now: NOW,
  });
  const second = createActivity({
    tab: tab(),
    settings: settings(),
    startedAt: NOW,
    now: NOW,
  });
  assert.equal(activityKey(first.activity), activityKey(second.activity));
  assert.equal(activityKey(null), 'null');
});
