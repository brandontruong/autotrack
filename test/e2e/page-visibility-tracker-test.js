/**
 * Copyright 2016 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */


import assert from 'assert';
import uuid from 'uuid';
import * as ga from './ga';
import {bindLogAccessors} from './server';
import * as constants from '../../lib/constants';
import pkg from '../../package.json';


const SESSION_TIMEOUT_IN_MILLISECONDS = 3000; // 3 seconds
const SESSION_TIMEOUT_IN_MINUTES = (1/60) * 3; // 3 seconds
const VISIBLE_THRESHOLD = 2000; // 2 seconds


const DEFAULT_TRACKER_FIELDS = {
  trackingId: 'UA-12345-1',
  cookieDomain: 'auto',
  siteSpeedSampleRate: 0,
};

const TEST_OPTS = {
  visibleThreshold: 0,
};


let testId;
let log;


describe('pageVisibilityTracker', function() {
  this.retries(4);

  beforeEach(() => {
    testId = uuid();
    log = bindLogAccessors(testId);
    browser.url('/test/e2e/fixtures/autotrack.html?tab=1');
    clearStorage();
    browser.execute(ga.run, 'create', DEFAULT_TRACKER_FIELDS);
    browser.execute(ga.logHitData, testId);
  });

  afterEach(() => {
    closeAllButFirstTab();
    log.removeHits();
  });

  it('sends events to track the time a page was visible', function() {
    if (!browserSupportsTabs()) return this.skip();

    browser.execute(ga.run, 'require', 'pageVisibilityTracker', TEST_OPTS);
    openNewTab();

    browser.waitUntil(log.hitCountEquals(1));

    const hits = log.getHits();
    assert.strictEqual(hits[0].ec, 'Page Visibility');
    assert.strictEqual(hits[0].ea, 'track');
  });

  it('tracks the elapsed time a page was visible', function() {
    if (!browserSupportsTabs()) return this.skip();

    browser.execute(ga.run, 'require', 'pageVisibilityTracker', TEST_OPTS);
    browser.pause(2000);
    openNewTab();

    browser.waitUntil(log.hitCountEquals(1));

    const hits = log.getHits();
    assert(Number(hits[0].ev) >= 2);
  });

  it('sends events as nonInteraction by default', function() {
    if (!browserSupportsTabs()) return this.skip();

    browser.execute(ga.run, 'require', 'pageVisibilityTracker', TEST_OPTS);
    openNewTab();
    closeAllButFirstTab();
    openNewTab();

    browser.waitUntil(log.hitCountEquals(2));

    const hits = log.getHits();
    assert.strictEqual(hits[0].ni, '1');
    assert.strictEqual(hits[1].ni, '1');
  });

  it('uses a custom metric if specified', function() {
    if (!browserSupportsTabs()) return this.skip();

    browser.execute(ga.run, 'require', 'pageVisibilityTracker', {
      visibleThreshold: 0,
      visibleMetricIndex: 1,
    });

    browser.pause(1000);
    openNewTab();

    browser.waitUntil(log.hitCountEquals(1));

    const hits = log.getHits();
    assert(Number(hits[0].ev) >= 1);
    assert(Number(hits[0].cm1) >= 1);
  });

  it('does not send any hidden events if the session has expired', function() {
    if (!browserSupportsTabs()) return this.skip();

    browser.execute(ga.run, 'require', 'pageVisibilityTracker', {
      visibleThreshold: 0,
      sessionTimeout: SESSION_TIMEOUT_IN_MINUTES,
    });

    expireSession();
    log.removeHits();

    openNewTab();
    log.assertNoHitsReceived();
    closeAllButFirstTab();
  });

  it('sends a pageview on session-expiry when changing to visible', function() {
    if (!browserSupportsTabs()) return this.skip();

    browser.execute(ga.run, 'require', 'pageVisibilityTracker', TEST_OPTS);

    expireSession();
    log.removeHits();

    openNewTab();
    closeAllButFirstTab();
    browser.waitUntil(log.hitCountEquals(1));

    // Expects non-pageview hits queued to be sent after the session has timed
    // out to include a pageview immediately before them.
    const hits = log.getHits();
    assert.strictEqual(hits[0].t, 'pageview');
  });

  it('does not send a session-expiry pageview on initial pageload', function() {
    if (!browserSupportsTabs()) return this.skip();

    browser.execute(ga.run, 'require', 'pageVisibilityTracker', TEST_OPTS);

    expireSession();
    log.removeHits();

    openNewWindow('/test/e2e/fixtures/autotrack.html?window=1');
    browser.execute(ga.run, 'create', DEFAULT_TRACKER_FIELDS);
    browser.execute(ga.logHitData, testId);
    browser.execute(ga.run, 'require', 'pageVisibilityTracker', TEST_OPTS);

    log.assertNoHitsReceived();
  });

  it('resets the session timeout when other hits are sent', function() {
    if (!browserSupportsTabs()) return this.skip();

    browser.execute(ga.run, 'require', 'pageVisibilityTracker', {
      visibleThreshold: 0,
      sessionTimeout: SESSION_TIMEOUT_IN_MINUTES,
    });
    browser.execute(ga.run, 'send', 'pageview');
    browser.pause(SESSION_TIMEOUT_IN_MILLISECONDS / 3);

    browser.execute(ga.run, 'send', 'event', 'Uncategorized', 'unimportant');
    browser.pause(SESSION_TIMEOUT_IN_MILLISECONDS / 3);

    browser.execute(ga.run, 'send', 'event', 'Uncategorized', 'unimportant');
    browser.pause(SESSION_TIMEOUT_IN_MILLISECONDS / 3);

    openNewTab();
    browser.waitUntil(log.hitCountEquals(4));

    const hits = log.getHits();
    assert.strictEqual(hits[0].t, 'pageview');
    assert.strictEqual(hits[1].ec, 'Uncategorized');
    assert.strictEqual(hits[1].ea, 'unimportant');
    assert.strictEqual(hits[2].ec, 'Uncategorized');
    assert.strictEqual(hits[2].ea, 'unimportant');

    // Since each hit above resets the session timeout, opening a new
    // tab will still be considered within the session timeout.
    assert.strictEqual(hits[3].ea, 'track');
  });

  it('only sends events when the visibleThreshold is met', function() {
    if (!browserSupportsTabs()) return this.skip();

    browser.execute(ga.run, 'require', 'pageVisibilityTracker', {
      visibleThreshold: VISIBLE_THRESHOLD,
      sessionTimeout: SESSION_TIMEOUT_IN_MINUTES,
    });
    openNewTab();
    closeAllButFirstTab();
    openNewTab();
    closeAllButFirstTab();
    openNewTab();
    closeAllButFirstTab();
    log.assertNoHitsReceived();

    browser.pause(VISIBLE_THRESHOLD);
    openNewTab();
    browser.waitUntil(log.hitCountEquals(1));

    const hits = log.getHits();
    assert.strictEqual(hits[0].ec, 'Page Visibility');
    assert.strictEqual(hits[0].ea, 'track');
  });

  it('waits to send pageviews until the visibleThreshold is met', function() {
    if (!browserSupportsTabs()) return this.skip();

    browser.execute(ga.run, 'require', 'pageVisibilityTracker', {
      visibleThreshold: VISIBLE_THRESHOLD,
      sessionTimeout: SESSION_TIMEOUT_IN_MINUTES,
    });

    expireSession();
    log.removeHits();

    openNewTab();
    closeAllButFirstTab();
    const start = Date.now();

    browser.waitUntil(log.hitCountEquals(1));
    const end = Date.now();

    // Expects non-pageview hits queued to be sent after the session has timed
    // out to include a pageview immediately before them.
    const hits = log.getHits();
    assert.strictEqual(hits[0].t, 'pageview');
    assert(hits[0].qt >= VISIBLE_THRESHOLD);
    assert(end - start >= VISIBLE_THRESHOLD);
  });

  it('handles closing a window/tab when a visible window is still open',
      function() {
    if (!browserSupportsTabs()) return this.skip();

    const tab1 = browser.getCurrentTabId();
    browser.execute(ga.run, 'require', 'pageVisibilityTracker', TEST_OPTS);

    const window1 = openNewWindow('/test/e2e/fixtures/autotrack.html?window=1');
    browser.execute(ga.run, 'create', DEFAULT_TRACKER_FIELDS);
    browser.execute(ga.logHitData, testId);
    browser.execute(ga.run, 'require', 'pageVisibilityTracker', TEST_OPTS);

    browser.close(tab1); // Close window1 and switch to tab1.
    openNewTab();

    browser.waitUntil(log.hitCountEquals(3));

    // Use the references to make the linter happy.
    assert(tab1 && window1);

    const hits = log.getHits();

    // window1 change:visible
    assert(hits[0].dl.endsWith('tab=1'));
    assert.strictEqual(hits[0].ea, 'track');
    // window1 change:hidden
    assert(hits[1].dl.endsWith('window=1'));
    assert.strictEqual(hits[1].ea, 'track');
    // tab1 url change to tab=1a
    assert(hits[2].dl.endsWith('tab=1'));
    assert.strictEqual(hits[2].ea, 'track');
  });

  it('reports visibility if the page path changes on a visible page',
      function() {
    if (!browserSupportsTabs()) return this.skip();

    browser.execute(ga.run, 'require', 'pageVisibilityTracker', TEST_OPTS);
    browser.execute(ga.run, 'send', 'pageview');
    browser.pause(randomInteger(500, 2000));

    // Simulate a URL change on the tracker.
    browser.execute(ga.run,
        'set', 'page', '/test/e2e/fixtures/autotrack.html?tab=1a');
    browser.execute(ga.run, 'send', 'pageview');
    browser.pause(randomInteger(500, 2000));

    // Simulate another URL change on the tracker.
    browser.execute(ga.run,
        'set', 'page', '/test/e2e/fixtures/autotrack.html?tab=1b');
    browser.execute(ga.run, 'send', 'pageview');

    browser.waitUntil(log.hitCountEquals(5));
    const hits = log.getHits();

    // Tab 1 pageview
    assert(hits[0].dl.endsWith('tab=1'));
    assert.strictEqual(hits[0].t, 'pageview');
    // Tab 1 url change to tab=1a
    assert(hits[1].dl.endsWith('tab=1'));
    assert.strictEqual(hits[1].ea, 'track');
    assert(Number(hits[1].ev) > 0);
    // Pageview
    assert(hits[2].dp.endsWith('tab=1a'));
    assert.strictEqual(hits[2].t, 'pageview');
    // Tab 1 url change to tab=1b
    assert(hits[3].dp.endsWith('tab=1a'));
    assert.strictEqual(hits[3].ea, 'track');
    assert(Number(hits[3].ev) > 0);
    // Pageview
    assert(hits[4].dp.endsWith('tab=1b'));
    assert.strictEqual(hits[4].t, 'pageview');
  });

  it('reports the proper page path when 2+ tabs are used simultaneously',
        function() {
    if (!browserSupportsTabs()) return this.skip();

    const tab1 = browser.getCurrentTabId();
    browser.execute(ga.run, 'require', 'pageVisibilityTracker', TEST_OPTS);
    browser.execute(ga.run, 'send', 'pageview');
    browser.pause(randomInteger(500, 2000));

    const tab2 = openNewTab('/test/e2e/fixtures/blank.html');
    browser.pause(randomInteger(500, 2000));

    const tab3 = openNewTab('/test/e2e/fixtures/autotrack.html?tab=3');
    browser.execute(ga.run, 'create', DEFAULT_TRACKER_FIELDS);
    browser.execute(ga.logHitData, testId);
    browser.execute(ga.run, 'require', 'pageVisibilityTracker', TEST_OPTS);
    browser.execute(ga.run, 'send', 'pageview');
    browser.pause(randomInteger(500, 2000));

    browser.close(tab2); // Close tab3 and go to tab2.
    browser.pause(randomInteger(500, 2000));

    browser.close(tab1); // Close tab2 and go to tab1.
    browser.waitUntil(log.hitCountEquals(4));

    // Use the references to make the linter happy.
    assert(tab1 && tab2 && tab3);

    const hits = log.getHits();
    // Tab 1 pageview
    assert(hits[0].dl.endsWith('tab=1'));
    assert.strictEqual(hits[0].t, 'pageview');
    // Tab 1 change:hidden
    assert(hits[1].dl.endsWith('tab=1'));
    assert.strictEqual(hits[1].ea, 'track');
    assert(Number(hits[1].ev) > 0);
    // Tab 2 (no pageview or visiblity event)
    // Tab 3 pageview
    assert(hits[2].dl.endsWith('tab=3'));
    assert.strictEqual(hits[2].t, 'pageview');
    // Tab 3 change:hidden
    assert(hits[3].dl.endsWith('tab=3'));
    assert.strictEqual(hits[3].ea, 'track');
    assert(Number(hits[3].ev) > 0);
    // Tab 2 (no visiblity event)
    // Tab 1 change:visible

    log.removeHits();
  });

  it('does not double report when 2+ tabs are used simultaneously', function() {
    if (!browserSupportsTabs()) return this.skip();

    const tab1 = browser.getCurrentTabId();
    browser.execute(ga.run, 'require', 'pageVisibilityTracker', TEST_OPTS);
    browser.execute(ga.run, 'send', 'pageview');
    browser.pause(randomInteger(500, 2000));

    const tab2 = openNewTab('/test/e2e/fixtures/autotrack.html?tab=2');
    browser.execute(ga.run, 'create', DEFAULT_TRACKER_FIELDS);
    browser.execute(ga.logHitData, testId);
    browser.execute(ga.run, 'require', 'pageVisibilityTracker', TEST_OPTS);
    browser.execute(ga.run, 'send', 'pageview');
    browser.pause(randomInteger(500, 2000));

    const tab3 = openNewTab('/test/e2e/fixtures/blank.html');
    browser.pause(randomInteger(500, 2000));

    const tab4 = openNewTab('/test/e2e/fixtures/autotrack.html?tab=4');
    browser.execute(ga.run, 'create', DEFAULT_TRACKER_FIELDS);
    browser.execute(ga.logHitData, testId);
    browser.execute(ga.run, 'require', 'pageVisibilityTracker', TEST_OPTS);
    browser.execute(ga.run, 'send', 'pageview');
    browser.pause(randomInteger(500, 2000));

    browser.close(tab3); // Close tab4 and go to tab3.
    browser.pause(randomInteger(500, 2000));

    browser.close(tab2); // Close tab3 and go to tab2.
    browser.pause(randomInteger(500, 2000));

    browser.close(tab1); // Close tab2 and go to tab1.
    browser.waitUntil(log.hitCountEquals(7));

    // Use the references to make the linter happy.
    assert(tab1 && tab2 && tab3 && tab4);

    const hits = log.getHits();
    // Tab 1 pageview
    assert(hits[0].dl.endsWith('tab=1'));
    assert.strictEqual(hits[0].t, 'pageview');
    // Tab 1 change:hidden
    assert(hits[1].dl.endsWith('tab=1'));
    assert.strictEqual(hits[1].ea, 'track');
    assert(Number(hits[1].ev) > 0);
    // Tab 2 pageview (change:visible)
    assert(hits[2].dl.endsWith('tab=2'));
    assert.strictEqual(hits[2].t, 'pageview');
    // Tab 2 change:hidden
    assert(hits[3].dl.endsWith('tab=2'));
    assert.strictEqual(hits[3].ea, 'track');
    assert(Number(hits[3].ev) > 0);
    // Tab 3 (no pageview or visiblity event)
    // Tab 4 pagevew (change:visible)
    assert(hits[4].dl.endsWith('tab=4'));
    assert.strictEqual(hits[4].t, 'pageview');
    // Tab 4 change:hidden
    assert(hits[5].dl.endsWith('tab=4'));
    assert.strictEqual(hits[5].ea, 'track');
    assert(Number(hits[5].ev) > 0);
    // Tab 3 (no visiblity event)
    // Tab 2 change:visible
    // Tab 2 change:hidden
    assert(hits[6].dl.endsWith('tab=2'));
    assert.strictEqual(hits[6].ea, 'track');
    assert(Number(hits[6].ev) > 0);
    // Tab 1 change:visible

    log.removeHits();
  });

  it('works with multiple tabs and windows open simultaneously', function() {
    if (!browserSupportsTabs()) return this.skip();

    const tab1 = browser.getCurrentTabId();
    browser.execute(ga.run, 'require', 'pageVisibilityTracker', TEST_OPTS);
    browser.execute(ga.run, 'send', 'pageview');
    browser.pause(randomInteger(500, 2000));

    const tab2 = openNewTab('/test/e2e/fixtures/blank.html');
    browser.pause(randomInteger(500, 2000));

    const tab3 = openNewTab('/test/e2e/fixtures/autotrack.html?tab=3');
    browser.execute(ga.run, 'create', DEFAULT_TRACKER_FIELDS);
    browser.execute(ga.logHitData, testId);
    browser.execute(ga.run, 'require', 'pageVisibilityTracker', TEST_OPTS);
    browser.execute(ga.run, 'send', 'pageview');
    browser.pause(randomInteger(500, 2000));

    const window1 = openNewWindow('/test/e2e/fixtures/autotrack.html?window=1');
    browser.execute(ga.run, 'create', DEFAULT_TRACKER_FIELDS);
    browser.execute(ga.logHitData, testId);
    browser.execute(ga.run, 'require', 'pageVisibilityTracker', TEST_OPTS);
    browser.execute(ga.run, 'send', 'pageview');
    browser.pause(randomInteger(500, 2000));

    const window2 = openNewWindow('/test/e2e/fixtures/autotrack.html?window=2');
    browser.execute(ga.run, 'create', DEFAULT_TRACKER_FIELDS);
    browser.execute(ga.logHitData, testId);
    browser.execute(ga.run, 'require', 'pageVisibilityTracker', TEST_OPTS);
    browser.execute(ga.run, 'send', 'pageview');
    browser.pause(randomInteger(500, 2000));

    browser.close(tab3); // Close window2 and switch to tab3.
    browser.pause(randomInteger(500, 2000));

    browser.close(window1); // Close tab3 and go to window1.
    browser.pause(randomInteger(500, 2000));

    browser.close(tab2); // Close window1 and go to tab2.
    browser.pause(randomInteger(500, 2000));

    browser.close(tab1); // Close tab2 and go to tab1.

    browser.waitUntil(log.hitCountEquals(10));

    // Use the references to make the linter happy.
    assert(tab1 && tab2 && tab3 && window1 && window2);

    const hits = log.getHits();

    // tab1 pageview
    assert(hits[0].dl.endsWith('tab=1'));
    assert.strictEqual(hits[0].t, 'pageview');
    // tab1 change:hidden
    assert(hits[1].dl.endsWith('tab=1'));
    assert.strictEqual(hits[1].ea, 'track');
    assert(Number(hits[1].ev) > 0);
    // tab2 (no pageview or visiblity event)
    // tab3 pageview (change:visible)
    assert(hits[2].dl.endsWith('tab=3'));
    assert.strictEqual(hits[2].t, 'pageview');
    // window1 change:visible
    assert(hits[3].dl.endsWith('tab=3'));
    assert.strictEqual(hits[3].ea, 'track');
    assert(Number(hits[3].ev) > 0);
    // window1 pageview
    assert(hits[4].dl.endsWith('window=1'));
    assert.strictEqual(hits[4].t, 'pageview');
    // window2 change:visible
    assert(hits[5].dl.endsWith('window=1'));
    assert.strictEqual(hits[5].ea, 'track');
    assert(Number(hits[5].ev) > 0);
    // window2 pageview
    assert(hits[6].dl.endsWith('window=2'));
    assert.strictEqual(hits[6].t, 'pageview');
    // window2 change:hidden
    assert(hits[7].dl.endsWith('window=2'));
    assert.strictEqual(hits[7].ea, 'track');
    assert(Number(hits[7].ev) > 0);
    // tab3 change:hidden
    assert(hits[8].dl.endsWith('tab=3'));
    assert.strictEqual(hits[8].ea, 'track');
    assert(Number(hits[8].ev) > 0);
    // window1 change:hidden
    assert(hits[9].dl.endsWith('window=1'));
    assert.strictEqual(hits[9].ea, 'track');
    assert(Number(hits[9].ev) > 0);
    // tab2 (no visiblity event)

    log.removeHits();
  });

  it('works with multiple tabs across multiple sessions', function() {
    if (!browserSupportsTabs()) return this.skip();

    const tab1 = browser.getCurrentTabId();
    browser.execute(ga.run, 'require', 'pageVisibilityTracker', TEST_OPTS);
    browser.execute(ga.run, 'send', 'pageview');
    browser.pause(randomInteger(500, 2000));

    const tab2 = openNewTab('/test/e2e/fixtures/blank.html');
    browser.pause(randomInteger(500, 2000));

    const tab3 = openNewTab('/test/e2e/fixtures/autotrack.html?tab=3');
    browser.execute(ga.run, 'create', DEFAULT_TRACKER_FIELDS);
    browser.execute(ga.logHitData, testId);
    browser.execute(ga.run, 'require', 'pageVisibilityTracker', TEST_OPTS);
    browser.execute(ga.run, 'send', 'pageview');
    browser.pause(randomInteger(500, 2000));

    const tab4 = openNewTab('/test/e2e/fixtures/autotrack.html?tab=4');
    browser.execute(ga.run, 'create', DEFAULT_TRACKER_FIELDS);
    browser.execute(ga.logHitData, testId);
    browser.execute(ga.run, 'require', 'pageVisibilityTracker', TEST_OPTS);
    browser.execute(ga.run, 'send', 'pageview');
    browser.pause(randomInteger(500, 2000));

    // Manually expire session 1
    expireSession();
    browser.pause(randomInteger(500, 2000));

    browser.close(tab3); // Close tab4 and go to tab3.
    browser.pause(randomInteger(500, 2000));

    browser.close(tab2); // Close tab3 and go to tab2.
    browser.pause(randomInteger(500, 2000));

    browser.close(tab1); // Close tab2 and go to tab1.

    // browser.waitUntil(log.hitCountEquals(11));
    browser.pause(1000);

    // Use the references to make the linter happy.
    assert(tab1 && tab2 && tab3 && tab4);

    const hits = log.getHits();
    // Session 1 start
    // tab1 pageview
    assert(hits[0].dl.endsWith('tab=1'));
    assert.strictEqual(hits[0].t, 'pageview');
    // tab1 change:hidden
    assert(hits[1].dl.endsWith('tab=1'));
    assert.strictEqual(hits[1].ea, 'track');
    assert(Number(hits[1].ev) > 0);
    // tab2 (no pageview or visiblity event)
    // tab3 pageview (change:visible)
    assert(hits[2].dl.endsWith('tab=3'));
    assert.strictEqual(hits[2].t, 'pageview');
    // tab3 change:hidden
    assert(hits[3].dl.endsWith('tab=3'));
    assert.strictEqual(hits[3].ea, 'track');
    assert(Number(hits[3].ev) > 0);
    // tab4 pageview (change:visible)
    assert(hits[4].dl.endsWith('tab=4'));
    assert.strictEqual(hits[4].t, 'pageview');
    // Session 1 end

    // Session 2 start
    // tab4 close (no visibility event)
    // tab3 pageview (due to session expiring)
    assert(hits[5].dl.endsWith('tab=3'));
    assert.strictEqual(hits[5].t, 'pageview');
    // tab3 change:hidden
    assert(hits[6].dl.endsWith('tab=3'));
    assert.strictEqual(hits[6].ea, 'track');
    assert(Number(hits[6].ev) > 0);
    // tab2 (no visiblity event)
    // tab1 change:visible
    // Session 2 end
  });

  it('supports customizing any field via the fieldsObj', function() {
    if (!browserSupportsTabs()) return this.skip();

    browser.execute(ga.run, 'require', 'pageVisibilityTracker', {
      visibleThreshold: 0,
      fieldsObj: {
        dimension1: 'pageVisibilityTracker',
        nonInteraction: false,
      },
    });
    browser.execute(ga.run, 'send', 'pageview');

    openNewTab();
    browser.waitUntil(log.hitCountEquals(2));

    const hits = log.getHits();
    assert.strictEqual(hits[0].t, 'pageview');
    assert.strictEqual(hits[0].ni, undefined);
    assert.strictEqual(hits[1].cd1, 'pageVisibilityTracker');
    assert.strictEqual(hits[1].ni, '0');
  });

  it('supports specifying a hit filter', function() {
    if (!browserSupportsTabs()) return this.skip();

    browser.execute(requirePageVisibilityTracker_hitFilter);
    browser.execute(ga.run, 'send', 'pageview');

    openNewTab();
    browser.waitUntil(log.hitCountEquals(2));

    const hits = log.getHits();
    assert.strictEqual(hits[0].t, 'pageview');
    assert.strictEqual(hits[1].ea, 'track');
    assert.strictEqual(hits[1].cd1, String(hits[1].ev));
  });

  it('includes usage params with all hits', () => {
    browser.execute(ga.run, 'require', 'pageVisibilityTracker', TEST_OPTS);
    browser.execute(ga.run, 'send', 'pageview');
    browser.waitUntil(log.hitCountEquals(1));

    const hits = log.getHits();
    assert.strictEqual(hits[0].t, 'pageview');
    assert.strictEqual(hits[0].did, constants.DEV_ID);
    assert.strictEqual(hits[0][constants.VERSION_PARAM], pkg.version);

    // '40' = '0001000000' in hex
    assert.strictEqual(hits[0][constants.USAGE_PARAM], '40');
  });

  describe('remove', () => {
    it('destroys all bound events and functionality', () => {
      browser.execute(ga.run, 'require', 'pageVisibilityTracker', TEST_OPTS);
      browser.execute(ga.run, 'send', 'pageview');

      log.removeHits();
      browser.execute(ga.run, 'pageVisibilityTracker:remove');

      openNewTab();
      log.assertNoHitsReceived();
    });
  });
});


/**
 * @return {boolean} True if the current browser works with the open/close
 * tab methods defined in this file.
 */
function browserSupportsTabs() {
  const browserCaps = browser.session().value;
  return !(
      // TODO(philipwalton): on Sauce Labs, Internet explorer and Safari open
      // target="_blank" links in a new window, not tab.
      browserCaps.browserName == 'internet explorer' ||
      browserCaps.browserName == 'safari' ||
      // TODO(philipwalton): Firefox driver (not the regular browser) emits
      // visibility change event in the wrong order.
      // https://bugzilla.mozilla.org/show_bug.cgi?id=1318098
      browserCaps.browserName == 'firefox');
}


/**
 * Opens a new tab by inserting a link with target="_blank" into the DOM
 * and then clicking on it.
 * @param {string} url A an optional URL to navigate to, defaulting to
 *     '/test/e2e/fixtures/blank.htm'.
 * @return {string} The tab ID.
 */
function openNewTab(url) {
  const oldTabIds = browser.getTabIds();
  browser.execute((url) => {
    const a = document.createElement('a');
    a.href = url || '/test/e2e/fixtures/blank.htm';
    a.target = '_blank';
    a.id = 'new-tab-link';
    a.setAttribute('style', 'position:fixed;top:0;left:0;right:0;bottom:0');
    a.onclick = () => document.body.removeChild(a);
    document.body.appendChild(a);
  }, url);
  browser.element('#new-tab-link').click();

  browser.pause(500);
  browser.waitUntil(() => {
    const newTabIds = browser.getTabIds();
    if (newTabIds.length > oldTabIds.length) {
      browser.switchTab(newTabIds[newTabIds.length - 1]);
      return true;
    }
    return false;
  }, 2000, 'New tab was never opened.', 500);

  return browser.getCurrentTabId();
}


/**
 * Opens a new window by inserting a button with a window.open script handler
 * into the DOM and then clicking on it.
 * @param {string} url A URL to navigate to.
 * @return {string} The window ID.
 */
function openNewWindow(url) {
  const oldTabIds = browser.getTabIds();
  browser.execute((url) => {
    const div = document.createElement('div');
    div.id = 'new-window-link';
    div.setAttribute('style', 'position:fixed;top:0;left:0;right:0;bottom:0');
    div.onclick = () => {
      window.open(url, 'newWindow' + Math.random(), 'width=600,height=400');
      document.body.removeChild(div);
    };
    document.body.appendChild(div);
  }, url);
  browser.element('#new-window-link').click();

  browser.pause(500);
  browser.waitUntil(() => {
    const newTabIds = browser.getTabIds();
    if (newTabIds.length > oldTabIds.length) {
      browser.switchTab(newTabIds[newTabIds.length - 1]);
      return true;
    }
    return false;
  }, 2000, 'New window was never opened.', 500);

  return browser.getCurrentTabId();
}


/**
 * Closes all tabs other than the oldest one.
 */
function closeAllButFirstTab() {
  const windowHandles = browser.windowHandles().value;
  windowHandles.forEach((handle, index) => {
    if (index > 0) browser.switchTab(handle).close();
  });
}


/**
 * Manually clear all stores.
 */
function clearStorage() {
  setStoreData('autotrack:UA-12345-1:session', {});
  setStoreData('autotrack:UA-12345-1:plugins/page-visibility-tracker', {});
}


/**
 * Manually expires the session.
 */
function expireSession() {
  setStoreData('autotrack:UA-12345-1:session', {isExpired: true});
}


/**
 * Manually set a value for store in all open windows/tabs.
 * @param {string} key
 * @param {!Object} value
 */
function setStoreData(key, value) {
  browser.execute((key, value) => {
    const oldValue = window.localStorage.getItem(key);
    const newValue = JSON.stringify(value);

    // IE11 doesn't support event constructors.
    try {
      // Set the value on localStorage so it triggers the storage event in
      // other tabs. Also, manually dispatch the event in this tab since just
      // writing to localStorage won't update the locally cached values.
      window.localStorage.setItem(key, newValue);
      window.dispatchEvent(
          new StorageEvent('storage', {key, oldValue, newValue}));
    } catch(err) {
      // Do nothing
    }
  }, key, value);
}


/**
 * Since function objects can't be passed via parameters from server to
 * client, this one-off function must be used to set the value for
 * `hitFilter`.
 */
function requirePageVisibilityTracker_hitFilter() {
  ga('require', 'pageVisibilityTracker', {
    visibleThreshold: 0,
    hitFilter: (model) => {
      const eventValue = model.get('eventValue');
      model.set('dimension1', String(eventValue), true);
    },
  });
}


/**
 * Randomly picks an interger between the two passed values (inclusively).
 * @param {number} min The lowest value to pick.
 * @param {number} max The lowest value to pick.
 * @return {number} The random integer picked.
 */
function randomInteger(min, max) {
  return Math.floor(Math.random() * (max - min)) + min;
}
