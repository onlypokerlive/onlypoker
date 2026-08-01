"use client"

import { useState } from "react"
import { Check, ChevronDown, Copy, Flag, KeyRound, Settings2, UserMinus } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { pokerApi, saveSession, type GameView, type Session, type TableControl } from "@/lib/poker-api"
import { failureCategory, recordHostContinuity } from "@/lib/growth"

/**
 * The host's controls over the night rather than over a hand.
 *
 * Deliberately plain. Removing somebody from a table of friends is a social
 * act, not a game event — the research doc is explicit that it gets no
 * animation and no flourish, because dressing it up turns an awkward moment
 * into a public spectacle. Two taps, a name, and it is done. Calling the last
 * hand is the same kind of decision, so it lives in the same drawer.
 */
export function HostPanel({
  view,
  roomId,
  onDone,
  session,
}: {
  view: GameView
  roomId: string
  onDone: () => void
  session: Session | null
}) {
  const [confirming, setConfirming] = useState<string | null>(null)
  const [confirmingHost, setConfirmingHost] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [recoveryCode, setRecoveryCode] = useState(session?.recoveryCode ?? null)
  const [copied, setCopied] = useState(false)

  // Only the host, and only where the server will accept it: never mid-hand,
  // and never once the placings are written. A button that exists to fail is
  // worse than no button.
  if (!view.isHost || view.phase === "hand" || view.phase === "finished") return null
  const others = view.players.filter((p) => !p.isYou)

  async function remove(targetId: string) {
    setBusy(true)
    try {
      await pokerApi.kickPlayer(roomId, view.you!.id, targetId, session?.token)
      setConfirming(null)
      onDone()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove that player.")
    } finally {
      setBusy(false)
    }
  }

  async function control(action: TableControl) {
    setBusy(true)
    try {
      await pokerApi.controlTable(
        roomId,
        view.you!.id,
        action,
        session?.token,
      )
      onDone()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update the table.")
    } finally {
      setBusy(false)
    }
  }

  async function createBackup() {
    if (!session || !view.you) return
    setBusy(true)
    recordHostContinuity("backup", "attempted")
    try {
      const nextSession = await pokerApi.createHostBackup(
        roomId,
        view.you.id,
        session.token,
      )
      saveSession(nextSession)
      setRecoveryCode(nextSession.recoveryCode ?? null)
      recordHostContinuity("backup", "succeeded")
      toast.success("Host backup code created")
    } catch (error) {
      recordHostContinuity("backup", "failed", failureCategory(error))
      toast.error(error instanceof Error ? error.message : "Could not create a host backup.")
    } finally {
      setBusy(false)
    }
  }

  async function copyBackup() {
    if (!recoveryCode || !navigator.clipboard?.writeText) {
      toast.error("Copying is not available in this browser.")
      return
    }
    await navigator.clipboard.writeText(recoveryCode)
    setCopied(true)
    toast.success("Host backup code copied")
    window.setTimeout(() => setCopied(false), 1500)
  }

  async function transfer(targetId: string) {
    if (!session || !view.you) return
    setBusy(true)
    recordHostContinuity("transfer", "attempted")
    try {
      await pokerApi.transferHost(roomId, view.you.id, targetId, session.token)
      saveSession({
        roomId: session.roomId,
        playerId: session.playerId,
        token: session.token,
        isHost: false,
        spectator: session.spectator,
      })
      setRecoveryCode(null)
      setConfirmingHost(null)
      recordHostContinuity("transfer", "succeeded")
      toast.success("Host access transferred")
      onDone()
    } catch (error) {
      recordHostContinuity("transfer", "failed", failureCategory(error))
      toast.error(error instanceof Error ? error.message : "Could not transfer host access.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <details className="group rounded-xl border border-border/50 bg-card/50 px-3">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2">
          <Settings2 className="size-4 text-primary/70" aria-hidden />
          Host controls
        </span>
        <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="border-t border-border/40 pb-3 pt-1">
        <div className="mt-2 rounded-xl border border-primary/20 bg-primary/5 p-3">
          <div className="flex items-start gap-2">
            <KeyRound className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold text-foreground">Keep host access</h3>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                Save this one-time code somewhere private. It restores this host seat on another
                device and signs the old device out.
              </p>
            </div>
          </div>
          {recoveryCode ? (
            <div className="mt-2 flex items-center gap-2">
              <code className="min-w-0 flex-1 select-all truncate rounded-lg border border-border/60 bg-background/55 px-3 py-2 font-mono text-xs text-foreground">
                {recoveryCode}
              </code>
              <Button
                type="button"
                size="icon-lg"
                variant="outline"
                onClick={copyBackup}
                aria-label="Copy host backup code"
              >
                {copied ? <Check /> : <Copy />}
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              size="lg"
              variant="outline"
              className="mt-2 w-full"
              disabled={busy}
              onClick={createBackup}
            >
              <KeyRound data-icon="inline-start" />
              Create backup code
            </Button>
          )}
        </div>
        {/* Only once there is a night to end. In the lobby it would just be a
            button that stops a tournament nobody has started. */}
        {view.phase === "handover" && (
          <Button
            size="sm"
            variant={view.lastHand ? "secondary" : "ghost"}
            className="mt-2 w-full justify-start text-muted-foreground"
            disabled={busy}
            onClick={() => control(view.lastHand ? "keep-playing" : "last-hand")}
          >
            <Flag data-icon="inline-start" />
            {view.lastHand ? "Actually, keep playing" : "One more hand, then stop"}
          </Button>
        )}
        {others.length > 0 ? (
          <ul className="mt-2 flex flex-col gap-1">
            {others.map((p) => (
              <li key={p.id} className="flex min-h-11 items-center justify-between gap-2 text-sm">
                <span className="truncate text-card-foreground">{p.name}</span>
                {confirmingHost === p.id ? (
                  <span className="flex shrink-0 items-center gap-1">
                    <Button size="sm" variant="secondary" disabled={busy} onClick={() => transfer(p.id)}>
                      Make host
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmingHost(null)}>
                      Cancel
                    </Button>
                  </span>
                ) : confirming === p.id ? (
                  <span className="flex shrink-0 items-center gap-1">
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={busy}
                      onClick={() => remove(p.id)}
                    >
                      Remove
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                      Cancel
                    </Button>
                  </span>
                ) : (
                  <span className="flex shrink-0 items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-muted-foreground"
                      onClick={() => setConfirmingHost(p.id)}
                      aria-label={`Make ${p.name} the host`}
                    >
                      <KeyRound />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-muted-foreground"
                      onClick={() => setConfirming(p.id)}
                      aria-label={`Remove ${p.name}`}
                    >
                      <UserMinus />
                    </Button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </details>
  )
}
