/// <reference types="vite/client" />

import type { FoundryBridge } from '../../preload/bridge';

declare global {
  interface Window {
    foundry: FoundryBridge;
  }
}
