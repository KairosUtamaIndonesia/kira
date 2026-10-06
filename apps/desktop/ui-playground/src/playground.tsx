import { useState } from 'react';
import { AskUserPrototype } from './screens/ask-user-prototype';
import { ChatPreview } from './screens/chat-preview';

const experiments = [
  {
    id: 'chat-preview',
    name: 'Chat window',
    description: 'A starting point for exploring the chat layout and common states.',
    render: () => <ChatPreview />,
  },
  {
    id: 'ask-user',
    name: 'Ask user tool',
    description: 'Compare ways to answer Kira’s in-chat questions.',
    render: () => <AskUserPrototype />,
  },
];

export function Playground() {
  const [selectedId, setSelectedId] = useState(() => {
    const requested = new URLSearchParams(window.location.search).get('experiment');
    return experiments.some((experiment) => experiment.id === requested)
      ? requested
      : (experiments[0]?.id ?? null);
  });
  const selected = experiments.find((experiment) => experiment.id === selectedId);

  function openExperiment(id: string) {
    setSelectedId(id);
    const url = new URL(window.location.href);
    url.searchParams.set('experiment', id);
    if (id !== 'ask-user') url.searchParams.delete('variant');
    window.history.replaceState(null, '', url);
  }

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
              onClick={() => openExperiment(experiment.id)}
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
