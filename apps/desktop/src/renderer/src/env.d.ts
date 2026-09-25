/// <reference types="vite/client" />

import type { KiraBridge } from '../../preload/bridge';

declare global {
  interface Window {
    kira: KiraBridge;
  }
}
