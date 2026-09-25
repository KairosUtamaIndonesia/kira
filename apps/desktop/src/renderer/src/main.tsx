import { LayerProvider } from '@astryxdesign/core/Layer';
import { FoundryTheme } from '@foundry/theme';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
// After the theme: the layout below overrides Astryx in places, so it is read last.
import './styles.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Missing #root element');
}

createRoot(root).render(
  <StrictMode>
    <FoundryTheme>
      {/*
       * Astryx's toasts (used to undo an archive) portal into a detached
       * container outside this tree; without a LayerProvider somewhere above
       * them they fall back to an unthemed viewport instead of reading
       * Foundry's tokens. AppShell doesn't supply one yet, so this does.
       */}
      <LayerProvider>
        <App />
      </LayerProvider>
    </FoundryTheme>
  </StrictMode>,
);
