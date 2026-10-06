import { KiraTheme } from '@kira/theme';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Playground } from './playground';
import './playground.css';

const root = document.getElementById('root');

if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <KiraTheme>
      <Playground />
    </KiraTheme>
  </StrictMode>,
);
