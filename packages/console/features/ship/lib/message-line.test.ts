import { describe, expect, it } from 'vitest';

import { messageLine } from './message-line';

const ROLE_PREVIEW = '{"squadron":"hemma-feature-a1b2c3","role":"reviewer","template":"reviewer@2","charter":"You review every change before it';

describe('messageLine', () => {
  it.each([
    { contentType: 'application/vnd.aeolus.squadron.check-in+json', preview: '{"squadron":"hemma-feature-a1b2c3","model":"claude-opus-5-5"}', line: 'Checked in at its flagship' },
    { contentType: 'application/vnd.aeolus.squadron.role+json', preview: ROLE_PREVIEW, line: 'Given the role: reviewer' },
    { contentType: 'application/vnd.aeolus.squadron.on-station+json', preview: '{"squadron":"hemma-feature-a1b2c3","role":"reviewer"}', line: 'Took up the role: reviewer' },
    { contentType: 'application/vnd.aeolus.squadron.stand-down+json', preview: '{"squadron":"hemma-feature-a1b2c3"}', line: 'Asked to stand down' },
    { contentType: 'application/vnd.aeolus.squadron.stood-down+json', preview: '{"squadron":"hemma-feature-a1b2c3"}', line: 'Stood down' },
  ])('says the squadron message $contentType in words', ({ contentType, preview, line }) => {
    expect(messageLine({ contentType, preview })).toEqual({ text: line, isCode: false });
  });

  it('reads the content type without its parameters and in any case', () => {
    expect(messageLine({ contentType: 'Application/Vnd.Aeolus.Squadron.Check-In+JSON; charset=utf-8', preview: '{}' }).text).toBe('Checked in at its flagship');
  });

  it('says a role message whose role the preview cut off without it', () => {
    expect(messageLine({ contentType: 'application/vnd.aeolus.squadron.role+json', preview: '{"squadron":"a-very-long-squadron-id' }).text).toBe('Given its role');
  });

  it('shows other JSON as its fields in a compact mono line, nested values as …', () => {
    expect(messageLine({ contentType: 'application/json', preview: '{"task":"Review #42","priority":2,"urgent":true,"files":["a.ts"],"meta":{"x":1}}' })).toEqual({
      text: 'task Review #42 · priority 2 · urgent true · files … · meta …',
      isCode: true,
    });
  });

  it('leaves out a field the preview cut off', () => {
    expect(messageLine({ contentType: 'application/json', preview: '{"task":"Review #42","notes":"Look at the error handl' }).text).toBe('task Review #42');
  });

  it('shows JSON with no fields to read as its preview', () => {
    expect(messageLine({ contentType: 'application/json', preview: '[1, 2, 3]' })).toEqual({ text: '[1, 2, 3]', isCode: true });
  });

  it('shows plain text as its preview', () => {
    expect(messageLine({ contentType: 'text/plain', preview: 'Please review #42.' })).toEqual({ text: 'Please review #42.', isCode: false });
  });
});
