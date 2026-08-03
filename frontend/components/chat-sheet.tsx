"use client"

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react"
import { createPortal } from "react-dom"
import { MessageCircle, SendHorizontal, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  newRequestId,
  pokerApi,
  type ChatMessage,
  type ChatView,
  type Session,
} from "@/lib/poker-api"

const CLOSED_POLL_MS = 4_000
const OPEN_POLL_MS = 1_600
const PREVIEW_DURATION_MS = 6_000
const MAX_MESSAGE_CHARACTERS = 280
const CHAT_TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
})

function readKey(roomId: string) {
  return `holdem:chat-read:${roomId}`
}

function loadReadThrough(roomId: string): string | null {
  try {
    return localStorage.getItem(readKey(roomId))
  } catch {
    return null
  }
}

function storeReadThrough(roomId: string, messageId: string | null) {
  try {
    if (messageId) localStorage.setItem(readKey(roomId), messageId)
    else localStorage.removeItem(readKey(roomId))
  } catch {
    // Unread state is a local convenience; private browsing may deny storage.
  }
}

function unreadAfter(messages: ChatMessage[], messageId: string | null) {
  if (!messageId) return messages.length
  const index = messages.findIndex((message) => message.id === messageId)
  return index < 0 ? messages.length : messages.length - index - 1
}

function formatTime(timestamp: number) {
  return CHAT_TIME_FORMATTER.format(new Date(timestamp))
}

function ClosedChatPreview({
  message,
  onOpen,
  onDismiss,
  onExpire,
}: {
  message: ChatMessage
  onOpen: () => void
  onDismiss: () => void
  onExpire: () => void
}) {
  const [paused, setPaused] = useState(false)
  const author = message.isMine ? "You" : message.authorName

  useEffect(() => {
    if (paused) return
    const timeout = window.setTimeout(onExpire, PREVIEW_DURATION_MS)
    return () => window.clearTimeout(timeout)
  }, [message.id, onExpire, paused])

  return createPortal(
    <div className="pointer-events-none fixed inset-x-3 top-[calc(env(safe-area-inset-top)+3.5rem)] z-[65] sm:left-auto sm:right-4 sm:w-[22rem]">
      <aside
        aria-label="New table talk preview"
        data-chat-preview
        onPointerEnter={() => setPaused(true)}
        onPointerLeave={() => setPaused(false)}
        onFocusCapture={() => setPaused(true)}
        onBlurCapture={(event) => {
          const nextFocus = event.relatedTarget
          if (!(nextFocus instanceof Node) || !event.currentTarget.contains(nextFocus)) {
            setPaused(false)
          }
        }}
        className="room-panel pointer-events-auto flex min-h-16 overflow-hidden rounded-xl border-primary/35 shadow-[0_12px_32px_rgba(0,0,0,0.38)] motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-2 motion-safe:duration-200"
      >
        <span
          aria-hidden="true"
          className="w-1 shrink-0 bg-gradient-to-b from-primary via-primary/75 to-primary/25"
        />
        <button
          type="button"
          onClick={onOpen}
          aria-label={`Open table talk from ${author}`}
          className="min-w-0 flex-1 px-3 py-2 text-left outline-none focus-visible:bg-primary/10"
        >
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="truncate font-serif text-sm font-bold text-card-foreground">
              {author}
            </span>
            <span className="shrink-0 font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-primary/85">
              New on the rail
            </span>
          </span>
          <span className="mt-0.5 overflow-hidden text-xs leading-snug text-foreground [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] [overflow-wrap:anywhere]">
            {message.text}
          </span>
        </button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onDismiss}
          aria-label="Dismiss message preview"
          className="m-1.5 size-11 shrink-0 self-start text-muted-foreground"
        >
          <X className="size-3.5" />
        </Button>
      </aside>
    </div>,
    document.body,
  )
}

/**
 * Polling room chat in a fixed portal sheet.
 *
 * Closed chat polls slowly enough to keep the unread badge useful without
 * competing with the table's authoritative 1.2-second state loop. A POST
 * returns the whole bounded snapshot, so sending never waits on a second GET.
 */
export function ChatSheet({ roomId, session }: { roomId: string; session: Session }) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [canSend, setCanSend] = useState(!session.spectator)
  const [loaded, setLoaded] = useState(false)
  const [unread, setUnread] = useState(0)
  const [previewMessage, setPreviewMessage] = useState<ChatMessage | null>(null)
  const [draft, setDraft] = useState("")
  const [sending, setSending] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)

  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const openRef = useRef(false)
  const pollingRef = useRef(false)
  const initialisedRef = useRef(false)
  const readThroughRef = useRef<string | null>(null)
  const latestMessageIdRef = useRef<string | null>(null)
  const pendingRef = useRef<{ text: string; requestId: string } | null>(null)

  const markRead = useCallback(
    (nextMessages: ChatMessage[]) => {
      const latest = nextMessages.at(-1)?.id ?? null
      readThroughRef.current = latest
      storeReadThrough(roomId, latest)
      setUnread(0)
      setPreviewMessage(null)
    },
    [roomId],
  )

  const applySnapshot = useCallback(
    (snapshot: ChatView) => {
      setMessages(snapshot.messages)
      setCanSend(snapshot.canSend)
      setLoaded(true)
      setLoadError(null)

      const latestMessage = snapshot.messages.at(-1) ?? null
      const previousLatestId = latestMessageIdRef.current
      latestMessageIdRef.current = latestMessage?.id ?? null

      if (!initialisedRef.current) {
        initialisedRef.current = true
        readThroughRef.current = loadReadThrough(roomId)
        // The first visit establishes a baseline instead of calling up to 100
        // retained lines "new". A returning device keeps its persisted marker.
        if (!readThroughRef.current || openRef.current) {
          markRead(snapshot.messages)
          return
        }
        setUnread(unreadAfter(snapshot.messages, readThroughRef.current))
        return
      }

      if (openRef.current) {
        markRead(snapshot.messages)
        return
      }

      const nextUnread = unreadAfter(snapshot.messages, readThroughRef.current)
      setUnread(nextUnread)
      if (nextUnread === 0) setPreviewMessage(null)
      else if (latestMessage && latestMessage.id !== previousLatestId) {
        setPreviewMessage(latestMessage)
      }
    },
    [markRead, roomId],
  )

  const openChat = useCallback(() => {
    openRef.current = true
    setPreviewMessage(null)
    setOpen(true)
  }, [])

  const closeChat = useCallback(() => {
    openRef.current = false
    setOpen(false)
  }, [])

  const expirePreview = useCallback(() => setPreviewMessage(null), [])

  const dismissPreview = useCallback(() => {
    setPreviewMessage(null)
    window.requestAnimationFrame(() => triggerRef.current?.focus())
  }, [])

  const refresh = useCallback(async () => {
    if (pollingRef.current || document.visibilityState === "hidden") return
    pollingRef.current = true
    try {
      applySnapshot(await pokerApi.getChat(roomId, session.token))
    } catch (error) {
      setLoaded(true)
      setLoadError(error instanceof Error ? error.message : "Table talk is unavailable.")
    } finally {
      pollingRef.current = false
    }
  }, [applySnapshot, roomId, session.token])

  useEffect(() => {
    openRef.current = open
    if (open && initialisedRef.current) markRead(messages)
  }, [markRead, messages, open])

  useEffect(() => {
    // Start from a timer callback rather than synchronously cascading another
    // render from the setup effect. The interval is the same subscription.
    const initial = window.setTimeout(() => void refresh(), 0)
    const interval = window.setInterval(refresh, open ? OPEN_POLL_MS : CLOSED_POLL_MS)
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refresh()
      else setPreviewMessage(null)
    }
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      window.clearTimeout(initial)
      window.clearInterval(interval)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [open, refresh])

  useEffect(() => {
    if (!open) return
    const fallbackTrigger = triggerRef.current
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    closeRef.current?.focus()

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        closeChat()
        return
      }
      if (event.key !== "Tab") return

      const focusable = Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      )
      if (focusable.length === 0) {
        event.preventDefault()
        panelRef.current?.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("keydown", onKey)
      document.body.style.overflow = previousOverflow
      fallbackTrigger?.focus()
    }
  }, [closeChat, open])

  useEffect(() => {
    if (!open) return
    const frame = window.requestAnimationFrame(() => {
      if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
    })
    return () => window.cancelAnimationFrame(frame)
  }, [messages, open])

  async function handleSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const text = draft.trim()
    if (!text || !canSend || sending) return

    const pending =
      pendingRef.current?.text === text
        ? pendingRef.current
        : { text, requestId: newRequestId() }
    pendingRef.current = pending
    setSending(true)
    setSendError(null)
    try {
      const snapshot = await pokerApi.sendChat(
        roomId,
        session.token,
        pending.text,
        pending.requestId,
      )
      applySnapshot(snapshot)
      pendingRef.current = null
      setDraft("")
      textareaRef.current?.focus()
    } catch (error) {
      setSendError(error instanceof Error ? error.message : "Message not sent. Try again.")
    } finally {
      setSending(false)
    }
  }

  function handleComposerKey(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault()
      event.currentTarget.form?.requestSubmit()
    }
  }

  const unreadLabel = unread === 1 ? "1 unread message" : `${unread} unread messages`
  const previewAuthor = previewMessage?.isMine ? "You" : previewMessage?.authorName

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        ref={triggerRef}
        onClick={openChat}
        aria-label={`Table talk${unread ? `, ${unreadLabel}` : ""}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="relative text-muted-foreground"
      >
        <MessageCircle />
        {unread > 0 && (
          <span
            aria-hidden="true"
            className="absolute right-0.5 top-0.5 flex min-h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-black leading-none text-primary-foreground shadow-[0_0_0_2px_var(--background)]"
          >
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </Button>
      <span className="sr-only" role="status" aria-live="polite">
        {previewMessage
          ? `New table talk from ${previewAuthor}: ${previewMessage.text}`
          : unread > 0
            ? unreadLabel
            : ""}
      </span>

      {previewMessage && !open && (
        <ClosedChatPreview
          key={previewMessage.id}
          message={previewMessage}
          onOpen={openChat}
          onDismiss={dismissPreview}
          onExpire={expirePreview}
        />
      )}

      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-[70] flex items-end justify-center bg-black/55 backdrop-blur-[2px] sm:items-stretch sm:justify-end sm:p-3"
            onClick={closeChat}
          >
            <section
              ref={panelRef}
              tabIndex={-1}
              role="dialog"
              aria-modal="true"
              aria-labelledby="table-talk-title"
              aria-describedby="table-talk-description"
              data-chat-sheet
              onClick={(event) => event.stopPropagation()}
              className="room-panel flex h-[min(76dvh,42rem)] max-h-[calc(100dvh-env(safe-area-inset-top)-0.75rem)] w-full flex-col overflow-hidden rounded-t-[1.75rem] border-b-0 shadow-2xl sm:h-full sm:max-h-none sm:w-96 sm:rounded-2xl sm:border"
            >
              <header className="relative flex shrink-0 items-center justify-between border-b border-border/70 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-primary">
                    Live rail
                  </p>
                  <h2
                    id="table-talk-title"
                    className="font-serif text-xl font-bold text-card-foreground"
                  >
                    Table talk
                  </h2>
                  <p id="table-talk-description" className="text-xs text-muted-foreground">
                    This room only · newest 100
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  ref={closeRef}
                  onClick={closeChat}
                  aria-label="Close table talk"
                >
                  <X />
                </Button>
                <span
                  aria-hidden="true"
                  className="absolute inset-x-4 bottom-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent"
                />
              </header>

              {loadError && (
                <div
                  role="status"
                  className="mx-3 mt-3 rounded-lg border border-destructive/35 bg-destructive/10 px-3 py-2 text-xs text-destructive"
                >
                  {loadError} Retrying…
                </div>
              )}

              <ul
                ref={listRef}
                role="log"
                aria-label="Table talk messages"
                aria-live="polite"
                aria-relevant="additions"
                className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-3 py-4"
              >
                {!loaded ? (
                  <li className="flex h-full min-h-40 items-center justify-center text-sm text-muted-foreground">
                    Pulling up table talk…
                  </li>
                ) : messages.length === 0 ? (
                  <li className="flex h-full min-h-40 flex-col items-center justify-center gap-2 px-8 text-center text-muted-foreground">
                    <span className="flex size-10 items-center justify-center rounded-full border border-primary/30 bg-primary/10 text-primary">
                      <MessageCircle className="size-4" />
                    </span>
                    <p className="font-serif text-base font-semibold text-card-foreground">
                      The rail is quiet
                    </p>
                    <p className="text-xs">
                      Reactions, reads, and friendly needling stay with this table.
                    </p>
                  </li>
                ) : (
                  messages.map((message) => (
                    <li
                      key={message.id}
                      className={`flex ${message.isMine ? "justify-end" : "justify-start"}`}
                    >
                      <article
                        className={`max-w-[86%] rounded-2xl border px-3 py-2 shadow-sm ${
                          message.isMine
                            ? "rounded-br-md border-primary/35 bg-primary/10"
                            : "rounded-bl-md border-border/70 bg-background/35"
                        }`}
                      >
                        <div className="mb-1 flex items-baseline gap-2">
                          <p className="truncate text-xs font-bold text-card-foreground">
                            {message.isMine ? "You" : message.authorName}
                          </p>
                          <time
                            dateTime={new Date(message.createdAt).toISOString()}
                            className="shrink-0 text-[10px] tabular-nums text-muted-foreground"
                          >
                            {formatTime(message.createdAt)}
                          </time>
                        </div>
                        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground [overflow-wrap:anywhere]">
                          {message.text}
                        </p>
                      </article>
                    </li>
                  ))
                )}
              </ul>

              <footer
                className="shrink-0 border-t border-border/70 bg-background/20 px-3 pt-3"
                style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
              >
                {canSend ? (
                  <form onSubmit={handleSend} className="flex items-end gap-2">
                    <div className="min-w-0 flex-1">
                      <Textarea
                        ref={textareaRef}
                        aria-label="Message the table"
                        aria-describedby={sendError ? "chat-send-error chat-character-count" : "chat-character-count"}
                        value={draft}
                        maxLength={MAX_MESSAGE_CHARACTERS}
                        rows={2}
                        placeholder="Say it at the table…"
                        onChange={(event) => {
                          setDraft(event.target.value)
                          setSendError(null)
                          if (pendingRef.current?.text !== event.target.value.trim()) {
                            pendingRef.current = null
                          }
                        }}
                        onKeyDown={handleComposerKey}
                        className="max-h-24 min-h-11 resize-none bg-background/35 text-base md:text-sm"
                      />
                      <div className="mt-1 flex min-h-4 items-start justify-between gap-2 px-1 text-[10px]">
                        <p id="chat-send-error" role={sendError ? "alert" : undefined} className="text-destructive">
                          {sendError}
                        </p>
                        <span
                          id="chat-character-count"
                          className="ml-auto shrink-0 tabular-nums text-muted-foreground"
                        >
                          {draft.length}/{MAX_MESSAGE_CHARACTERS}
                        </span>
                      </div>
                    </div>
                    <Button
                      type="submit"
                      disabled={sending || !draft.trim()}
                      aria-label="Send message"
                      className="mb-5"
                    >
                      <SendHorizontal />
                      <span className="hidden min-[360px]:inline">Send</span>
                    </Button>
                  </form>
                ) : (
                  <div className="flex min-h-12 items-center justify-center rounded-xl border border-dashed border-border/70 px-4 text-center text-xs text-muted-foreground">
                    You’re watching — seated players can send table talk.
                  </div>
                )}
              </footer>
            </section>
          </div>,
          document.body,
        )}
    </>
  )
}
