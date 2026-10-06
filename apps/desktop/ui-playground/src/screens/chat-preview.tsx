export function ChatPreview() {
  return (
    <div className="chat-window">
      <aside className="chat-rail" aria-label="Chats">
        <div className="brand-mark" aria-label="Kira">
          K
        </div>
        <button className="rail-button selected" aria-label="Chats" type="button">
          ◷
        </button>
        <button className="rail-button" aria-label="Projects" type="button">
          ⌘
        </button>
        <button className="rail-button" aria-label="Settings" type="button">
          ⚙
        </button>
        <div className="avatar">A</div>
      </aside>

      <section className="chat-list" aria-label="Recent chats">
        <div className="chat-list-heading">
          <strong>Chats</strong>
          <button className="icon-button" aria-label="New chat" type="button">
            ＋
          </button>
        </div>
        <div className="search-box">
          ⌕ <span>Search chats</span>
        </div>
        <p className="list-label">TODAY</p>
        <button className="chat-row active" type="button">
          <span className="chat-row-title">Refine the onboarding flow</span>
          <span className="chat-row-subtitle">Let’s make the first run feel effortless.</span>
        </button>
        <button className="chat-row" type="button">
          <span className="chat-row-title">Review project structure</span>
          <span className="chat-row-subtitle">A few ideas for simplifying the setup.</span>
        </button>
        <p className="list-label">YESTERDAY</p>
        <button className="chat-row" type="button">
          <span className="chat-row-title">Plan the next release</span>
          <span className="chat-row-subtitle">Release notes and final checks.</span>
        </button>
      </section>

      <section className="conversation" aria-label="Conversation preview">
        <header className="conversation-header">
          <div>
            <strong>Refine the onboarding flow</strong>
            <span className="model-label">Example model · Ready</span>
          </div>
          <button className="icon-button" aria-label="More chat actions" type="button">
            ···
          </button>
        </header>

        <div className="messages">
          <div className="message user-message">
            Can we make the first run feel less like setup and more like getting started?
          </div>
          <div className="assistant-message">
            <div className="assistant-mark">K</div>
            <div>
              <p>
                Yes. The current flow asks people to make too many choices before they see what Kira
                can do.
              </p>
              <p>
                I’d lead with one useful next step, then let the rest of setup happen when it
                becomes relevant.
              </p>
              <div className="message-actions">
                <span>Copy</span>
                <span>↻</span>
                <span>···</span>
              </div>
            </div>
          </div>
          <div className="suggestions">
            <button type="button">Show me a simpler first-run flow</button>
            <button type="button">What could we postpone?</button>
          </div>
        </div>

        <form className="composer" onSubmit={(event) => event.preventDefault()}>
          <textarea aria-label="Message Kira" placeholder="Message Kira…" rows={2} />
          <div className="composer-footer">
            <div>
              <button type="button">＋</button>
              <span>Example model⌄</span>
            </div>
            <button className="send-button" aria-label="Send message" type="submit">
              ↑
            </button>
          </div>
        </form>
        <p className="disclaimer">Mock conversation · Nothing here is connected to Kira</p>
      </section>
    </div>
  );
}
