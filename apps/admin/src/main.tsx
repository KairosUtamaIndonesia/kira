import { Spinner } from '@astryxdesign/core/Spinner';
import { FoundryTheme } from '@foundry/theme';
import { StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { readOpening } from './api/opening';
// After the theme: the layout below overrides Astryx in places, so it is read last.
import './styles.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Missing #root element');
}

// Read once, before anything is drawn, and held as a promise the tree suspends on:
// the console has nothing to show until it knows who is asking. Both things that
// change the answer load this page again rather than redrawing it, so a reading
// taken here stays true for as long as it is on screen.
const opening = readOpening();

createRoot(root).render(
  <StrictMode>
    <FoundryTheme>
      <Suspense
        fallback={
          <div className="waiting">
            <Spinner label="Opening Foundry" />
          </div>
        }
      >
        <App opening={opening} />
      </Suspense>
    </FoundryTheme>
  </StrictMode>,
);
