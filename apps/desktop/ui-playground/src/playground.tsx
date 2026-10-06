import { useState } from 'react';
import { ChatPreview } from './screens/chat-preview';

const experiments = [
  {
    id: 'chat-preview',
    name: 'Chat window',
    description: 'A starting point for exploring the chat layout and common states.',
    render: () => <ChatPreview />,
  },
];

export function Playground() {
  const [selectedId, setSelectedId] = useState(experiments[0]?.id ?? null);
  const selected = experiments.find((experiment) => experiment.id === selectedId);

  return (
    <main className="playground">
      <header className="playground-header">
        <div>
          <p className="eyebrow">KIRA · DESKTOP UI</p>
          <h1>Playground</h1>
          <p className="lede">A scratchpad for trying interface ideas with mock data.</p>
        </div>
        <span className="dev-badge">LOCAL · NOT THE APP</span>
      </header>

      <div className="playground-layout">
        <nav className="experiment-list" aria-label="Experiments">
          <h2>Experiments</h2>
          {experiments.map((experiment) => (
            <button
              aria-current={experiment.id === selectedId ? 'page' : undefined}
              className="experiment-link"
              key={experiment.id}
              onClick={() => setSelectedId(experiment.id)}
              type="button"
            >
              <span>{experiment.name}</span>
              <span className="experiment-description">{experiment.description}</span>
            </button>
          ))}
          <p className="experiment-hint">
            Add a screen under <code>src/screens/</code>.
          </p>
        </nav>

        <section aria-label={selected?.name ?? 'Experiment preview'} className="preview-area">
          {selected?.render()}
        </section>
      </div>
    </main>
  );
}
