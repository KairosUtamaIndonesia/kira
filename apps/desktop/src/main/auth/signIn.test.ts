import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { AuthState } from '../../preload/bridge.ts';
import { type KeyStore, type StoredKey } from './keys.ts';
import { type Kira, handoffToken, type KeyVerdict, signIn, type SignIn } from './signIn.ts';

const DEVICE = 'brandons-laptop';
const SCHEME = 'ai.kira.kairos';
const MINTED = 'the-key-just-issued';

const REMEMBERED: StoredKey = {
  key: 'the-key-it-holds',
  user: { name: 'Ada Lovelace', email: 'ada@company.example' },
};

const SIGNED_IN: AuthState = { signedIn: true, user: REMEMBERED.user };
const SIGNED_OUT: AuthState = { signedIn: false };

/** Where the server does not simply answer well, and what it says instead. */
interface Quirks {
  /** What the server says about a key this device holds. */
  check?: KeyVerdict;
  /** Calls that do not answer, by the message they fail with. */
  fails?: Partial<Record<'claim' | 'retireDeviceKeys' | 'mintKey' | 'endSession', string>>;
}

/** The key store as the flow uses it, recording what it was asked to do. */
function memory(calls: string[], box: { held: StoredKey | null }): KeyStore {
  return {
    read: async () => {
      calls.push('read');
      return box.held;
    },
    write: async (stored) => {
      calls.push(`write ${stored.key}`);
      box.held = stored;
    },
    forget: async () => {
      calls.push('forget');
      box.held = null;
    },
  };
}

/** The server as the flow uses it, recording every call it is asked to make. */
function kira(calls: string[], quirks: Quirks = {}): Kira {
  const fail = (call: 'claim' | 'retireDeviceKeys' | 'mintKey' | 'endSession') => {
    const message = quirks.fails?.[call];
    if (message !== undefined) throw new Error(message);
  };

  return {
    openSignIn: async () => {
      calls.push('open the browser');
    },
    claim: async (token) => {
      calls.push(`claim ${token}`);
      fail('claim');
      return REMEMBERED.user;
    },
    retireDeviceKeys: async (device) => {
      calls.push(`retire the keys for ${device}`);
      fail('retireDeviceKeys');
    },
    mintKey: async (device) => {
      calls.push(`mint a key for ${device}`);
      fail('mintKey');
      return MINTED;
    },
    check: async (key) => {
      calls.push(`check ${key}`);
      return quirks.check ?? { kind: 'ok', user: REMEMBERED.user };
    },
    catalog: async (key) => {
      // Signing in never asks for the catalog, so this is only here to be a
      // `Kira`: what the server serves is the business of `pi/models.ts`.
      calls.push(`catalog ${key}`);
      return { kind: 'unavailable' };
    },
    usage: async (key) => {
      // Nor for what somebody has used: that belongs to `main/usage.ts`.
      calls.push(`usage ${key}`);
      return { kind: 'unavailable' };
    },
    memory: async (key) => {
      // Nor what somebody decided about memory: that belongs to `main/memory.ts`.
      calls.push(`memory ${key}`);
      return { kind: 'unavailable' };
    },
    saveMemory: async (key, decided) => {
      calls.push(`save memory ${key} ${String(decided.enabled)} ${decided.chosen ?? 'none'}`);
      return { kind: 'unavailable' };
    },
    endSession: async () => {
      calls.push('end the session');
      fail('endSession');
    },
    // The tracker is not sign-in's business at all: it belongs to `main/tracker.ts`,
    // and these are here only to be a `Kira`. A call that reached them would be
    // a bug in the flow, so they record it and answer nothing.
    projects: async () => {
      calls.push('projects');
      return { kind: 'unavailable' };
    },
    createProject: async () => {
      calls.push('create a project');
      return { kind: 'unavailable' };
    },
    queue: async () => {
      calls.push('queue');
      return { kind: 'unavailable' };
    },
    writeTicket: async () => {
      calls.push('write a ticket');
      return { kind: 'unavailable' };
    },
    changeTicket: async () => {
      calls.push('change a ticket');
      return { kind: 'unavailable' };
    },
    gateTicket: async () => {
      calls.push('gate a ticket');
      return { kind: 'unavailable' };
    },
    ungateTicket: async () => {
      calls.push('ungate a ticket');
      return { kind: 'unavailable' };
    },
    // The worker is not sign-in's business either, and for the same reason: it is the
    // main process's own offering, kept in `main/worker.ts`. A call reaching here would
    // be a flow doing something it does not do.
    registerWorker: async () => {
      calls.push('offer this desktop');
      return { kind: 'unavailable' };
    },
    heartbeatWorker: async () => {
      calls.push('say this desktop is here');
      return { kind: 'unavailable' };
    },
    workerGone: async () => {
      calls.push('say this desktop is gone');
      return { kind: 'unavailable' };
    },
    claimTicket: async () => {
      calls.push('claim a ticket');
      return { kind: 'unavailable' };
    },
    readTicket: async () => {
      calls.push('read a ticket');
      return { kind: 'unavailable' };
    },
    takeOverTicket: async () => {
      calls.push('take over a claim');
      return { kind: 'unavailable' };
    },
    judgeRun: async () => {
      calls.push('judge a run');
      return { kind: 'unavailable' };
    },
    readTranscript: async () => {
      calls.push('read a transcript');
      return { kind: 'unavailable' };
    },
    sayInRun: async () => {
      calls.push('say something in a run');
      return { kind: 'unavailable' };
    },
    releaseTicket: async () => {
      calls.push('let a claim go');
      return { kind: 'unavailable' };
    },
    startRun: async () => {
      calls.push('start a run');
      return { kind: 'unavailable' };
    },
    recordRun: async () => {
      calls.push('record a run');
      return { kind: 'unavailable' };
    },
    endRun: async () => {
      calls.push('end a run');
      return { kind: 'unavailable' };
    },
  };
}

interface Case {
  name: string;
  /** What the device already holds when the call is made. */
  held?: StoredKey | null;
  quirks?: Quirks;
  call: keyof SignIn;
  /** Only for `finish`: the token the deep link carried. */
  token?: string;
  /** What the call answers. */
  want?: unknown;
  /** What the call throws instead, where it is expected to throw at all. */
  wantError?: string;
  wantCalls: string[];
  /** What the device holds once the call has answered. */
  wantHeld?: StoredKey | null;
}

const CASES: Case[] = [
  {
    name: 'nothing is held, so nobody is signed in',
    held: null,
    call: 'current',
    want: SIGNED_OUT,
    wantCalls: ['read'],
  },
  {
    name: 'a key the server still honours says who signed in',
    held: REMEMBERED,
    call: 'current',
    want: SIGNED_IN,
    wantCalls: ['read', `check ${REMEMBERED.key}`],
    wantHeld: REMEMBERED,
  },
  {
    name: 'a key the server has stopped honouring is thrown away',
    held: REMEMBERED,
    quirks: { check: { kind: 'refused' } },
    call: 'current',
    want: SIGNED_OUT,
    wantCalls: ['read', `check ${REMEMBERED.key}`, 'forget'],
    wantHeld: null,
  },
  {
    name: 'a server that could not be asked is not a server that said no',
    held: REMEMBERED,
    quirks: { check: { kind: 'unreachable' } },
    call: 'current',
    want: SIGNED_IN,
    wantCalls: ['read', `check ${REMEMBERED.key}`],
    wantHeld: REMEMBERED,
  },
  {
    name: 'signing in opens the system browser',
    held: null,
    call: 'begin',
    want: undefined,
    wantCalls: ['open the browser'],
    wantHeld: null,
  },
  {
    name: 'the token from the deep link becomes a key on this machine',
    held: null,
    call: 'finish',
    token: 'a-token-from-the-deep-link',
    want: undefined,
    wantCalls: [
      'claim a-token-from-the-deep-link',
      `retire the keys for ${DEVICE}`,
      `mint a key for ${DEVICE}`,
      `write ${MINTED}`,
      'end the session',
      `signed in as ${REMEMBERED.user.name}`,
    ],
    wantHeld: { key: MINTED, user: REMEMBERED.user },
  },
  {
    name: 'a token the server will not trade leaves the device as it was',
    held: null,
    quirks: { fails: { claim: 'Invalid or expired token.' } },
    call: 'finish',
    token: 'a-token-already-spent',
    wantError: 'Invalid or expired token.',
    wantCalls: ['claim a-token-already-spent'],
    wantHeld: null,
  },
  {
    name: 'a device whose old keys cannot be retired is not given a new one',
    held: null,
    quirks: { fails: { retireDeviceKeys: 'the server is not reachable' } },
    call: 'finish',
    token: 'a-token-from-the-deep-link',
    wantError: 'the server is not reachable',
    wantCalls: ['claim a-token-from-the-deep-link', `retire the keys for ${DEVICE}`],
    wantHeld: null,
  },
  {
    name: 'a key that cannot be minted leaves the device as it was',
    held: null,
    quirks: { fails: { mintKey: 'the server is not reachable' } },
    call: 'finish',
    token: 'a-token-from-the-deep-link',
    wantError: 'the server is not reachable',
    wantCalls: [
      'claim a-token-from-the-deep-link',
      `retire the keys for ${DEVICE}`,
      `mint a key for ${DEVICE}`,
    ],
    wantHeld: null,
  },
  {
    name: 'a key that is issued is announced even if the session will not end',
    held: null,
    quirks: { fails: { endSession: 'the server is not reachable' } },
    call: 'finish',
    token: 'a-token-from-the-deep-link',
    want: undefined,
    wantCalls: [
      'claim a-token-from-the-deep-link',
      `retire the keys for ${DEVICE}`,
      `mint a key for ${DEVICE}`,
      `write ${MINTED}`,
      'end the session',
      `signed in as ${REMEMBERED.user.name}`,
    ],
    wantHeld: { key: MINTED, user: REMEMBERED.user },
  },
  {
    name: 'signing out forgets the key and says so',
    held: REMEMBERED,
    call: 'signOut',
    want: SIGNED_OUT,
    wantCalls: ['forget', 'signed out', 'end the session'],
    wantHeld: null,
  },
  {
    name: 'signing out does not depend on reaching the server',
    held: REMEMBERED,
    quirks: { fails: { endSession: 'the server is not reachable' } },
    call: 'signOut',
    want: SIGNED_OUT,
    wantCalls: ['forget', 'signed out', 'end the session'],
    wantHeld: null,
  },
];

for (const testCase of CASES) {
  test(testCase.name, async () => {
    const calls: string[] = [];
    const box = { held: testCase.held ?? null };
    const auth = signIn({
      keys: memory(calls, box),
      kira: kira(calls, testCase.quirks),
      device: DEVICE,
      onChange: (state) => {
        calls.push(state.signedIn ? `signed in as ${state.user.name}` : 'signed out');
      },
    });

    const run = {
      current: () => auth.current(),
      begin: () => auth.begin(),
      finish: () => auth.finish(String(testCase.token)),
      signOut: () => auth.signOut(),
    } as const;

    if (testCase.wantError !== undefined) {
      await assert.rejects(run[testCase.call](), { message: testCase.wantError });
    } else {
      assert.deepEqual(await run[testCase.call](), testCase.want);
    }

    assert.deepEqual(calls, testCase.wantCalls);
    assert.deepEqual(box.held, testCase.wantHeld ?? null);
  });
}

/**
 * The deep link is the one thing here that arrives from outside — from the
 * browser, by way of the operating system — so what counts as a sign-in is
 * settled in one place, and everything else is left alone rather than followed.
 */
const LINKS = [
  {
    name: 'the link the server builds for the app',
    link: `${SCHEME}://auth/callback#token=a-token`,
    want: 'a-token',
  },
  {
    name: 'a token that arrives encoded',
    link: `${SCHEME}://auth/callback#token=a%2Fb%3Dc`,
    want: 'a/b=c',
  },
  {
    name: 'a link addressed to another application',
    link: 'some.other.app://auth/callback#token=a-token',
    want: null,
  },
  {
    name: 'a link on a path sign-in does not come back through',
    link: `${SCHEME}://auth/something-else#token=a-token`,
    want: null,
  },
  { name: 'a link with no token on it', link: `${SCHEME}://auth/callback`, want: null },
  { name: 'a link with nothing but a scheme', link: `${SCHEME}:/`, want: null },
  {
    name: 'the application path, which is what a second launch passes',
    link: '/home/someone/kira/apps/desktop',
    want: null,
  },
  { name: 'not a link at all', link: 'not a link at all', want: null },
];

for (const testCase of LINKS) {
  test(`a deep link: ${testCase.name}`, () => {
    assert.equal(handoffToken(testCase.link, SCHEME), testCase.want);
  });
}
