import { useState } from "react";

/** Adds a host: name, WebSocket URL and token (the token goes to the OS credential store). */
export function HostForm(props: {
  onSubmit(host: { name: string; url: string; token: string }): void;
}) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  return (
    <form
      className="card form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim() || !url.trim() || !token.trim()) return;
        props.onSubmit({ name: name.trim(), url: url.trim(), token: token.trim() });
      }}
    >
      <label>
        Nome
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="meu pc" />
      </label>
      <label>
        URL
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="ws://127.0.0.1:7420/v1/ws"
        />
      </label>
      <label>
        Token
        <input type="password" value={token} onChange={(e) => setToken(e.target.value)} />
      </label>
      <button type="submit" className="primary">
        Adicionar host
      </button>
    </form>
  );
}
