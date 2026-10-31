import { describe, expect, it } from 'vitest';

import { messageTextOf } from './message-text';

const MARKDOWN = 'text/markdown';
const PLAIN = 'text/plain';

describe('messageTextOf', () => {
  it('takes the first line as the headline and the rest as the body', () => {
    const text = messageTextOf({ contentType: PLAIN, payload: 'PR #412 is ready\n\nCI green, reviewer-2 found nothing blocking.' });

    expect(text.headline).toBe('PR #412 is ready');
    expect(text.summary).toBe('CI green, reviewer-2 found nothing blocking.');
    expect(text.body).toEqual([{ kind: 'paragraph', children: [{ kind: 'text', text: 'CI green, reviewer-2 found nothing blocking.' }] }]);
  });

  it('has no body or summary for a one-line message', () => {
    const text = messageTextOf({ contentType: PLAIN, payload: 'Slice 6 done' });

    expect(text).toEqual({ headline: 'Slice 6 done', summary: '', body: [], lineCount: 0, links: [] });
  });

  it('drops the heading marks of a markdown headline', () => {
    expect(messageTextOf({ contentType: MARKDOWN, payload: '## Slice 7 done\n\nMerged.' }).headline).toBe('Slice 7 done');
  });

  it('keeps the lines of a plain text paragraph as breaks', () => {
    const text = messageTextOf({ contentType: PLAIN, payload: 'Headline\n\none\ntwo' });

    expect(text.body).toEqual([
      { kind: 'paragraph', children: [{ kind: 'text', text: 'one' }, { kind: 'break' }, { kind: 'text', text: 'two' }] },
    ]);
  });

  it('makes a URL in plain text a link, leaving a closing full stop out', () => {
    const text = messageTextOf({ contentType: PLAIN, payload: 'Done\n\nSee https://example.com/a?b=1.' });

    expect(text.body).toEqual([
      {
        kind: 'paragraph',
        children: [
          { kind: 'text', text: 'See ' },
          { kind: 'link', url: 'https://example.com/a?b=1', children: [{ kind: 'text', text: 'https://example.com/a?b=1' }] },
          { kind: 'text', text: '.' },
        ],
      },
    ]);
  });

  it('renders a markdown list with emphasis and a link', () => {
    const text = messageTextOf({ contentType: MARKDOWN, payload: 'Slice 7\n\n- **CI** green\n- see [PR](https://github.com/example/tidewater/pull/412)' });

    expect(text.body).toEqual([
      {
        kind: 'list',
        isOrdered: false,
        start: null,
        items: [
          [{ kind: 'paragraph', children: [{ kind: 'strong', children: [{ kind: 'text', text: 'CI' }] }, { kind: 'text', text: ' green' }] }],
          [
            {
              kind: 'paragraph',
              children: [
                { kind: 'text', text: 'see ' },
                { kind: 'link', url: 'https://github.com/example/tidewater/pull/412', children: [{ kind: 'text', text: 'PR' }] },
              ],
            },
          ],
        ],
      },
    ]);
  });

  it('keeps a link that is not http, https or mailto as its text only', () => {
    const text = messageTextOf({ contentType: MARKDOWN, payload: 'Headline\n\n[click](javascript:alert(1))' });

    expect(text.body).toEqual([{ kind: 'paragraph', children: [{ kind: 'text', text: 'click' }] }]);
  });

  it('shows raw HTML in markdown as text, never as HTML', () => {
    const text = messageTextOf({ contentType: MARKDOWN, payload: 'Headline\n\n<script>alert(1)</script>' });

    expect(text.body).toEqual([{ kind: 'paragraph', children: [{ kind: 'text', text: '<script>alert(1)</script>' }] }]);
  });

  it('shows an image as its alt text', () => {
    const text = messageTextOf({ contentType: MARKDOWN, payload: 'Headline\n\n![a chart](https://example.com/c.png)' });

    expect(text.body).toEqual([{ kind: 'paragraph', children: [{ kind: 'text', text: 'a chart' }] }]);
  });

  it('takes the summary as plain text from a markdown body', () => {
    expect(messageTextOf({ contentType: MARKDOWN, payload: 'Headline\n\n- **CI** green\n- two' }).summary).toBe('CI green');
  });

  it('names the GitHub pull requests and issues it links to, once each', () => {
    const text = messageTextOf({
      contentType: PLAIN,
      payload: 'Issue filed: https://github.com/example/tidewater/issues/88\n\nFix in https://github.com/example/tidewater/pull/412 and https://github.com/example/tidewater/pull/412/files',
    });

    expect(text.links).toEqual([
      { kind: 'issue', url: 'https://github.com/example/tidewater/issues/88', repository: 'example/tidewater', number: 88 },
      { kind: 'pull', url: 'https://github.com/example/tidewater/pull/412', repository: 'example/tidewater', number: 412 },
    ]);
  });

  it('counts the body lines', () => {
    expect(messageTextOf({ contentType: PLAIN, payload: 'Headline\n\none\ntwo\nthree' }).lineCount).toBe(3);
  });

  it('shows a JSON payload as an indented code block under its first line', () => {
    const text = messageTextOf({ contentType: 'application/json', payload: '{"go":true}' });

    expect(text).toEqual({ headline: '{"go":true}', summary: '', body: [{ kind: 'code', text: '{\n  "go": true\n}' }], lineCount: 3, links: [] });
  });

  it('reads a content type without case and parameters', () => {
    expect(messageTextOf({ contentType: 'Text/Markdown; charset=utf-8', payload: '# Done' }).headline).toBe('Done');
  });

  it('reads any other content type as plain text', () => {
    expect(messageTextOf({ contentType: 'application/x-report', payload: 'Line one\n\n**not bold**' }).summary).toBe('**not bold**');
  });
});

describe('an alert message in the inbox (docs/design/monitoring, 4.8, N10)', () => {
  const ALERT = 'application/vnd.aeolus.alert+json';

  it('shows by its headline and its body as markdown, as a text/markdown message does', () => {
    const payload = JSON.stringify({
      alertId: 'alt_01m66p4k2v9qz8f7x3n5c1b0td',
      headline: 'merger-1: report unchanged 3 h 10 min, expected within 60 min',
      body: 'merger-1 reports **working**, unchanged since 12:05.',
      signal: 'report-unchanged',
    });

    const text = messageTextOf({ contentType: ALERT, payload });

    expect(text.headline).toBe('merger-1: report unchanged 3 h 10 min, expected within 60 min');
    expect(text.summary).toBe('merger-1 reports working, unchanged since 12:05.');
    expect(text.body).toEqual([
      { kind: 'paragraph', children: [{ kind: 'text', text: 'merger-1 reports ' }, { kind: 'strong', children: [{ kind: 'text', text: 'working' }] }, { kind: 'text', text: ', unchanged since 12:05.' }] },
    ]);
  });

  it('shows a payload that is no alert as a plain message', () => {
    expect(messageTextOf({ contentType: ALERT, payload: 'deploy-bot is stuck' }).headline).toBe('deploy-bot is stuck');
  });
});
