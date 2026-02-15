import { useState, useRef, useEffect } from "react"
import { pb } from "@/lib/pb"
import { Button } from "@/components/ui/button"
import { Play, Loader2 } from "lucide-react"

interface HistoryEntry {
  command: string
  output: string
  error?: string
  host: string
  timestamp: number
}

export function CommandTab() {
  const [command, setCommand] = useState("")
  const [running, setRunning] = useState(false)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const outputEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    outputEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [history])

  const runCommand = async () => {
    const cmd = command.trim()
    if (!cmd || running) return

    setRunning(true)
    try {
      const res = await pb.send("/api/ext/docker/exec", {
        method: "POST",
        body: { command: cmd },
      })
      setHistory((prev) => [
        ...prev,
        {
          command: cmd,
          output: res.output || "",
          error: res.error || "",
          host: res.host || "local",
          timestamp: Date.now(),
        },
      ])
      setCommand("")
    } catch (err) {
      setHistory((prev) => [
        ...prev,
        {
          command: cmd,
          output: "",
          error: String(err),
          host: "local",
          timestamp: Date.now(),
        },
      ])
    } finally {
      setRunning(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      runCommand()
    }
  }

  return (
    <div className="space-y-4 pt-4">
      <div className="flex items-center gap-2">
        <span className="text-sm font-mono text-muted-foreground select-none">docker</span>
        <input
          type="text"
          placeholder="ps -a --format json"
          className="flex-1 border rounded-md px-3 py-1.5 text-sm font-mono bg-background"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={running}
        />
        <Button size="sm" onClick={runCommand} disabled={running || !command.trim()}>
          {running ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          <span className="ml-1">Run</span>
        </Button>
      </div>

      <div className="bg-muted rounded-md p-4 min-h-[300px] max-h-[65vh] overflow-auto font-mono text-xs">
        {history.length === 0 && (
          <p className="text-muted-foreground">
            Enter a docker subcommand above and press Enter or click Run.
            <br />
            Example: <code>ps -a</code>, <code>images</code>, <code>compose ls</code>, <code>network ls</code>
          </p>
        )}
        {history.map((entry) => (
          <div key={entry.timestamp} className="mb-4">
            <div className="text-blue-500">
              $ docker {entry.command}
              <span className="text-muted-foreground ml-2">[{entry.host}]</span>
            </div>
            {entry.output && (
              <pre className="whitespace-pre-wrap mt-1">{entry.output}</pre>
            )}
            {entry.error && (
              <pre className="whitespace-pre-wrap mt-1 text-destructive">{entry.error}</pre>
            )}
          </div>
        ))}
        <div ref={outputEndRef} />
      </div>
    </div>
  )
}
