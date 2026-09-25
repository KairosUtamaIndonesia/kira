import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { AuthState } from '../../preload/bridge.ts';
import { type AuthDeps, type AuthHandlers, authHandlers } from './auth.ts';

const SIGNED_IN: AuthState = {
  signedIn: true,
  user: { name: 'Ada Lovelace', email: 'ada@company.example' },
};

interface Case {
  name: string;
  makeDeps: (calls: string[]) => AuthDeps;
  call: keyof AuthHandlers;
  want: unknown;
  wantCalls: string[];
}

/** Deps that record what they were asked to do; `overrides` replace one of them. */
function deps(calls: string[], overrides: Partial<AuthDeps> = {}): AuthDeps {
  return {
    current: async () => {
      calls.push('current');
      return SIGNED_IN;
    },
    begin: async () => {
      calls.push('begin');
    },
    signOut: async () => {
      calls.push('signOut');
      return { signedIn: false };
    },
    ...overrides,
  };
}

const CASES: Case[] = [
  {
    name: 'load says who is signed in',
    makeDeps: (calls) => deps(calls),
    call: 'load',
    want: { ok: true, value: SIGNED_IN },
    wantCalls: ['current'],
  },
  {
    name: 'load says nobody is signed in',
    makeDeps: (calls) => deps(calls, { current: async () => ({ signedIn: false }) }),
    call: 'load',
    want: { ok: true, value: { signedIn: false } },
    wantCalls: [],
  },
  {
    name: 'load reports a failure as a value',
    makeDeps: (calls) =>
      deps(calls, {
        current: async () => {
          throw new Error('the key store could not be read');
        },
      }),
    call: 'load',
    want: { ok: false, error: 'the key store could not be read' },
    wantCalls: [],
  },
  {
    name: 'signIn opens the browser and answers nothing',
    makeDeps: (calls) => deps(calls),
    call: 'signIn',
    want: { ok: true, value: null },
    wantCalls: ['begin'],
  },
  {
    name: 'signIn reports a failure as a value',
    makeDeps: (calls) =>
      deps(calls, {
        begin: async () => {
          throw new Error('no browser to open');
        },
      }),
    call: 'signIn',
    want: { ok: false, error: 'no browser to open' },
    wantCalls: [],
  },
  {
    name: 'signOut answers the state it left behind',
    makeDeps: (calls) => deps(calls),
    call: 'signOut',
    want: { ok: true, value: { signedIn: false } },
    wantCalls: ['signOut'],
  },
  {
    name: 'signOut reports a failure as a value',
    makeDeps: (calls) =>
      deps(calls, {
        signOut: async () => {
          throw new Error('the file is read-only');
        },
      }),
    call: 'signOut',
    want: { ok: false, error: 'the file is read-only' },
    wantCalls: [],
  },
];

for (const testCase of CASES) {
  test(testCase.name, async () => {
    const calls: string[] = [];
    const handlers = authHandlers(testCase.makeDeps(calls));
    const run = {
      load: () => handlers.load(),
      signIn: () => handlers.signIn(),
      signOut: () => handlers.signOut(),
    } as const;

    assert.deepEqual(await run[testCase.call](), testCase.want);
    assert.deepEqual(calls, testCase.wantCalls);
  });
}
