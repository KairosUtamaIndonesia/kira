import { describe, expect, test } from 'bun:test';
import { mergeAuditEvents } from './auditMerge';

describe('merging the audit', () => {
  test('lists admin and Pool events together, newest first', () => {
    const events = mergeAuditEvents(
      [
        {
          id: 'a1',
          actorLabel: 'ada@company.example',
          action: 'role',
          targetLabel: 'grace@company.example',
          outcome: 'succeeded',
          detail: 'admin',
          createdAt: '2026-10-06T10:00:00.000Z',
        },
      ],
      [
        {
          id: 'p1',
          actorLabel: 'ada@company.example',
          action: 'delete',
          provider: 'codex',
          credentialLabel: 'codex-ada',
          outcome: 'succeeded',
          detail: null,
          createdAt: '2026-10-06T11:00:00.000Z',
        },
      ],
    );

    expect(events.map((event) => event.id)).toEqual(['pool:p1', 'admin:a1']);
    expect(events[0]).toMatchObject({ actor: 'ada@company.example', target: 'codex-ada' });
    expect(events[1]).toMatchObject({ action: 'role', target: 'grace@company.example' });
  });

  test('falls back to the provider when a Pool event names no credential', () => {
    const [event] = mergeAuditEvents(
      [],
      [
        {
          id: 'p1',
          actorLabel: 'ada@company.example',
          action: 'login',
          provider: 'codex',
          credentialLabel: null,
          outcome: 'succeeded',
          detail: null,
          createdAt: '2026-10-06T10:00:00.000Z',
        },
      ],
    );

    expect(event?.target).toBe('codex');
  });
});
