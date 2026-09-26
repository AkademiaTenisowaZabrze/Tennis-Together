import { useState } from "react";
import { useAuth } from "../lib/AuthContext.jsx";
import { useConversations } from "../lib/useConversations.js";
import { useMessages } from "../lib/useMessages.js";
import ErrorBox from "../components/ErrorBox.jsx";

const KIND_LABELS = { ride: "Przejazd", lodging: "Nocleg" };

export default function MessagesPage() {
  const [openId, setOpenId] = useState(null);
  const { account } = useAuth();
  const { conversations, loading, error } = useConversations(account?.id);
  const open = conversations.find((c) => c.id === openId);

  if (open) {
    return <ChatView conversation={open} account={account} onBack={() => setOpenId(null)} />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <h1>Wiadomości</h1>

      {error && <ErrorBox>Nie udało się wczytać rozmów: {error}</ErrorBox>}
      {loading && <p style={{ color: "var(--color-text-muted)" }}>Wczytywanie…</p>}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {!loading &&
          conversations.map((c) => (
            <button
              key={c.id}
              className="list-item"
              onClick={() => setOpenId(c.id)}
              style={{ cursor: "pointer", textAlign: "left" }}
            >
              <div className="avatar-circle">{c.otherName[0]?.toUpperCase()}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong style={{ fontSize: 14 }}>{c.otherName}</strong>
                <p
                  style={{
                    margin: "2px 0 0",
                    fontSize: 13,
                    color: "var(--color-text-muted)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {KIND_LABELS[c.kind] ?? c.kind} · {c.title}
                </p>
              </div>
            </button>
          ))}
        {!loading && conversations.length === 0 && (
          <p style={{ color: "var(--color-text-muted)" }}>
            Nie masz jeszcze żadnej rozmowy. Rozmowa otwiera się automatycznie, gdy zaakceptujesz (albo Tobie
            zaakceptują) prośbę o dołączenie do przejazdu lub noclegu.
          </p>
        )}
      </div>
    </div>
  );
}

function ChatView({ conversation, account, onBack }) {
  const { messages, loading, error, sendMessage } = useMessages(conversation.id, account?.id);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(null);

  const handleSend = async (e) => {
    e.preventDefault();
    if (!draft.trim()) return;
    setSending(true);
    setSendError(null);
    const { error } = await sendMessage(draft);
    setSending(false);
    if (error) setSendError("Nie udało się wysłać wiadomości. Spróbuj ponownie.");
    else setDraft("");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 160px)" }}>
      <button className="btn-ghost" style={{ alignSelf: "flex-start", marginBottom: 12 }} onClick={onBack}>
        ← Wiadomości
      </button>
      <h2 style={{ margin: "0 0 4px" }}>{conversation.otherName}</h2>
      <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--color-text-muted)" }}>
        {KIND_LABELS[conversation.kind] ?? conversation.kind} · {conversation.title}
      </p>

      {error && <ErrorBox>Nie udało się wczytać wiadomości: {error}</ErrorBox>}

      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8, overflowY: "auto" }}>
        {loading && <p style={{ color: "var(--color-text-muted)" }}>Wczytywanie…</p>}
        {!loading && messages.length === 0 && (
          <p style={{ color: "var(--color-text-muted)", fontSize: 13 }}>
            Brak wiadomości — napisz pierwszą.
          </p>
        )}
        {messages.map((m) => {
          const mine = m.sender_account_id === account?.id;
          return (
            <div
              key={m.id}
              className={`chat-bubble ${mine ? "mine" : "theirs"}`}
              style={{ alignSelf: mine ? "flex-end" : "flex-start" }}
            >
              {m.body}
            </div>
          );
        })}
      </div>

      {sendError && <ErrorBox>{sendError}</ErrorBox>}
      <form onSubmit={handleSend} style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Napisz wiadomość…"
          style={{
            flex: 1,
            padding: "10px 14px",
            borderRadius: 999,
            border: "1px solid var(--color-card-border)",
            background: "var(--color-bg-elevated)",
            color: "var(--color-text)",
          }}
        />
        <button className="btn-primary" type="submit" disabled={sending}>
          Wyślij
        </button>
      </form>
    </div>
  );
}
