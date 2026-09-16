import { FormEvent, useCallback, useEffect, useState } from 'react';

import { ApiError, createNotification, listNotifications, redriveDeadLetter, redriveNotification, whoami } from './api';
import { TEMPLATES, toInput } from './templates';
import type { NotificationItem, NotificationPage, Status } from './types';

const PAGE_SIZE = 10;
const POLL_MS = 2_000;
const KEY_STORAGE = 'notification-gateway.api-key';

const STATUS_LABEL: Record<Status, string> = {
  PENDING: 'Pendente',
  PROCESSING: 'Processando',
  SENT: 'Enviada',
  FAILED: 'Falhou',
};

function storedKey(): string {
  return localStorage.getItem(KEY_STORAGE) || import.meta.env.VITE_API_KEY || '';
}

function formatWhen(value: string): string {
  return new Date(value).toLocaleString('pt-BR');
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'Algo deu errado.';
}

export function App() {
  const [apiKey, setApiKey] = useState(storedKey);
  const [client, setClient] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  const [templateIndex, setTemplateIndex] = useState(0);
  const [recipient, setRecipient] = useState(TEMPLATES[0].recipient);
  const [payloadText, setPayloadText] = useState(JSON.stringify(TEMPLATES[0].payload, null, 2));
  const [sending, setSending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [lastCreated, setLastCreated] = useState<NotificationItem | null>(null);
  const [callbackUrl, setCallbackUrl] = useState('');
  const [redrivingId, setRedrivingId] = useState<string | null>(null);

  const [page, setPage] = useState(1);
  const [listing, setListing] = useState<NotificationPage | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const template = TEMPLATES[templateIndex];
  const pageCount = Math.max(1, Math.ceil((listing?.total ?? 0) / PAGE_SIZE));

  const applyTemplate = useCallback((index: number) => {
    const next = TEMPLATES[index];
    setTemplateIndex(index);
    setRecipient(next.recipient);
    setPayloadText(JSON.stringify(next.payload, null, 2));
    setFormError(null);
  }, []);

  useEffect(() => {
    localStorage.setItem(KEY_STORAGE, apiKey);
  }, [apiKey]);

  useEffect(() => {
    if (!apiKey.trim()) {
      setClient(null);
      setAuthError('Informe a API key do serviço.');
      return;
    }

    let cancelled = false;

    void whoami(apiKey)
      .then((identity) => {
        if (!cancelled) {
          setClient(identity.client);
          setAuthError(null);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setClient(null);
          setAuthError(errorMessage(error));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [apiKey]);

  useEffect(() => {
    if (!client) {
      setListing(null);
      return;
    }

    let cancelled = false;

    const load = () => {
      void listNotifications(apiKey, page, PAGE_SIZE)
        .then((result) => {
          if (!cancelled) {
            setListing(result);
            setListError(null);
          }
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setListError(errorMessage(error));
          }
        });
    };

    load();
    const timer = window.setInterval(load, POLL_MS);

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        load();
      }
    };

    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [apiKey, client, page]);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFormError(null);

    let payload: Record<string, unknown>;

    try {
      const parsed: unknown = JSON.parse(payloadText);

      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('Payload precisa ser um objeto JSON.');
      }

      payload = parsed as Record<string, unknown>;
    } catch (error: unknown) {
      setFormError(error instanceof SyntaxError ? 'Payload não é um JSON válido.' : errorMessage(error));
      return;
    }

    setSending(true);

    try {
      const created = await createNotification(apiKey, {
        ...toInput(template),
        recipient: recipient.trim(),
        payload,
        ...(callbackUrl.trim() ? { callbackUrl: callbackUrl.trim() } : {}),
      });
      setLastCreated(created);
      setPage(1);
    } catch (error: unknown) {
      setFormError(errorMessage(error));
    } finally {
      setSending(false);
    }
  }

  async function onRedrive(id: string): Promise<void> {
    setRedrivingId(id);
    setListError(null);

    try {
      await redriveNotification(apiKey, id);
    } catch (error: unknown) {
      setListError(errorMessage(error));
    } finally {
      setRedrivingId(null);
    }
  }

  async function onRedriveDead(): Promise<void> {
    setRedrivingId('dead');
    setListError(null);

    try {
      await redriveDeadLetter(apiKey);
    } catch (error: unknown) {
      setListError(errorMessage(error));
    } finally {
      setRedrivingId(null);
    }
  }

  return (
    <div className="page">
      <header className="hero">
        <p className="eyebrow">Notification Gateway</p>
        <h1>Mini-painel</h1>
        <p className="lede">
          Envia um pedido para a API e acompanha o status enquanto o worker entrega. Não é o produto —
          é a prova de que o backend está no ar.
        </p>
      </header>

      <section className="card key-card">
        <label htmlFor="api-key">API key</label>
        <input
          id="api-key"
          type="password"
          autoComplete="off"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          placeholder="sk_…"
        />
        <p className={client ? 'hint ok' : 'hint err'} role="status">
          {client ? `Conectado como ${client}` : (authError ?? '…')}
        </p>
      </section>

      <div className="layout">
        <form className="card" onSubmit={(event) => void onSubmit(event)}>
          <h2>Enviar</h2>

          <label htmlFor="template">Modelo</label>
          <select
            id="template"
            value={templateIndex}
            onChange={(event) => applyTemplate(Number(event.target.value))}
          >
            {TEMPLATES.map((item, index) => (
              <option key={item.label} value={index}>
                {item.label}
              </option>
            ))}
          </select>

          <div className="row">
            <div>
              <label htmlFor="channel">Canal</label>
              <input id="channel" value={template.channel} readOnly />
            </div>
            <div>
              <label htmlFor="eventType">Evento</label>
              <input id="eventType" value={template.eventType} readOnly />
            </div>
          </div>

          <label htmlFor="recipient">Destinatário</label>
          <input
            id="recipient"
            value={recipient}
            onChange={(event) => setRecipient(event.target.value)}
            required
          />

          <label htmlFor="payload">Payload (JSON)</label>
          <textarea
            id="payload"
            rows={8}
            spellCheck={false}
            value={payloadText}
            onChange={(event) => setPayloadText(event.target.value)}
          />

          <label htmlFor="callbackUrl">Webhook de desfecho (opcional)</label>
          <input
            id="callbackUrl"
            type="url"
            value={callbackUrl}
            onChange={(event) => setCallbackUrl(event.target.value)}
            placeholder="https://seu-servico/hooks/notifications"
          />

          {formError ? (
            <p className="hint err" role="alert">
              {formError}
            </p>
          ) : null}

          {lastCreated ? (
            <p className="hint ok">
              Aceito <code>{lastCreated.id}</code> · {STATUS_LABEL[lastCreated.status]}
            </p>
          ) : null}

          <button type="submit" disabled={sending || !client}>
            {sending ? 'Enviando…' : 'Enviar notificação'}
          </button>
        </form>

        <section className="card table-card">
          <div className="table-head">
            <h2>Notificações</h2>
            <div className="table-actions">
              <p className="hint">Atualiza a cada 2s</p>
              <button
                type="button"
                className="ghost"
                disabled={!client || redrivingId === 'dead'}
                onClick={() => void onRedriveDead()}
              >
                Reprocessar DLQ
              </button>
            </div>
          </div>

          {listError ? (
            <p className="hint err" role="alert">
              {listError}
            </p>
          ) : !listing || listing.items.length === 0 ? (
            <p className="empty">Nenhuma notificação ainda.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Quando</th>
                    <th>Canal</th>
                    <th>Evento</th>
                    <th>Destinatário</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {listing.items.map((item) => (
                    <tr key={item.id}>
                      <td>{formatWhen(item.createdAt)}</td>
                      <td>{item.channel}</td>
                      <td>{item.eventType}</td>
                      <td className="mono">{item.recipient}</td>
                      <td>
                        <span className={`status status-${item.status.toLowerCase()}`}>
                          {STATUS_LABEL[item.status]}
                        </span>
                        {item.status === 'FAILED' && item.failureReason ? (
                          <span className="fail-reason">{item.failureReason}</span>
                        ) : null}
                      </td>
                      <td>
                        {item.status === 'FAILED' ? (
                          <button
                            type="button"
                            className="ghost compact"
                            disabled={redrivingId === item.id}
                            onClick={() => void onRedrive(item.id)}
                          >
                            {redrivingId === item.id ? 'Reprocessando…' : 'Reprocessar'}
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="pager">
            <button type="button" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>
              Anterior
            </button>
            <span>
              Página {page} de {pageCount}
              {listing ? ` · ${listing.total} no total` : ''}
            </span>
            <button
              type="button"
              disabled={page >= pageCount}
              onClick={() => setPage((current) => current + 1)}
            >
              Próxima
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
