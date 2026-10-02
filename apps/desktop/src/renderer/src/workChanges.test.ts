import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { TicketChange } from '../../preload/bridge.ts';
import { bodyChange, checksChange, titleChange } from './workChanges.ts';

test('a title is sent only when it names something new', () => {
  const cases: { name: string; held: string; typed: string; want: TicketChange | null }[] = [
    {
      name: 'renamed',
      held: 'Ship the board',
      typed: 'Ship the list',
      want: { title: 'Ship the list' },
    },
    {
      name: 'renamed with space around it',
      held: 'Ship the board',
      typed: '  Ship the list  ',
      want: { title: 'Ship the list' },
    },
    { name: 'unchanged', held: 'Ship the board', typed: 'Ship the board', want: null },
    {
      name: 'unchanged but for space around it',
      held: 'Ship the board',
      typed: ' Ship the board ',
      want: null,
    },
    { name: 'emptied', held: 'Ship the board', typed: '', want: null },
    { name: 'emptied to whitespace', held: 'Ship the board', typed: '   ', want: null },
    {
      name: 'typed into an untitled ticket',
      held: '',
      typed: 'Name it',
      want: { title: 'Name it' },
    },
  ];

  for (const each of cases) {
    assert.deepEqual(titleChange(each.held, each.typed), each.want, each.name);
  }
});

test('a description is sent whenever it differs, an emptied one included', () => {
  const cases: { name: string; held: string; typed: string; want: TicketChange | null }[] = [
    { name: 'rewritten', held: 'Old words', typed: 'New words', want: { body: 'New words' } },
    { name: 'unchanged', held: 'Old words', typed: 'Old words', want: null },
    { name: 'emptied', held: 'Old words', typed: '', want: { body: '' } },
    { name: 'written for the first time', held: '', typed: 'About it', want: { body: 'About it' } },
    {
      name: 'space alone is kept as written',
      held: 'Old words',
      typed: '  New words  ',
      want: { body: '  New words  ' },
    },
  ];

  for (const each of cases) {
    assert.deepEqual(bodyChange(each.held, each.typed), each.want, each.name);
  }
});

test('checks are sent as the whole list, trimmed, with blank lines dropped', () => {
  const cases: {
    name: string;
    held: string[];
    typed: string[];
    want: TicketChange | null;
  }[] = [
    { name: 'unchanged', held: ['Tests pass'], typed: ['Tests pass'], want: null },
    {
      name: 'unchanged but for space around it',
      held: ['Tests pass'],
      typed: ['  Tests pass  '],
      want: null,
    },
    {
      name: 'one line rewritten',
      held: ['Tests pass'],
      typed: ['Checks pass'],
      want: { criteria: ['Checks pass'] },
    },
    {
      name: 'a line added',
      held: ['Tests pass'],
      typed: ['Tests pass', 'Docs updated'],
      want: { criteria: ['Tests pass', 'Docs updated'] },
    },
    {
      name: 'a line added as an empty row',
      held: ['Tests pass'],
      typed: ['Tests pass', ''],
      want: null,
    },
    {
      name: 'a line removed',
      held: ['Tests pass', 'Docs updated'],
      typed: ['Tests pass'],
      want: { criteria: ['Tests pass'] },
    },
    { name: 'every line removed', held: ['Tests pass'], typed: [''], want: { criteria: [] } },
    {
      name: 'reordered',
      held: ['Tests pass', 'Docs updated'],
      typed: ['Docs updated', 'Tests pass'],
      want: { criteria: ['Docs updated', 'Tests pass'] },
    },
    {
      name: 'the first check of a ticket that had none',
      held: [],
      typed: ['Tests pass'],
      want: { criteria: ['Tests pass'] },
    },
  ];

  for (const each of cases) {
    assert.deepEqual(checksChange(each.held, each.typed), each.want, each.name);
  }
});
