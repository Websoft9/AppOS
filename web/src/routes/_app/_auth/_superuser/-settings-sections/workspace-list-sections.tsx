import { useState, useCallback, useRef } from 'react'
import { CheckCircle2, Download, GripVertical, HelpCircle, Loader2, Plus, Trash2, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SaveButton, Toggle } from './shared'

type TestState = 'idle' | 'testing' | 'success' | 'error'

const MIRRORS_QUICK_ADD_URL = 'https://artifact.websoft9.com/websoft9/dev/mirrors.json'

async function testMirrorUrl(url: string, timeoutMs = 8000): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    await fetch(url, { method: 'HEAD', mode: 'no-cors', signal: controller.signal })
    return true
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

function moveListItem(items: string[], fromIndex: number, toIndex: number) {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) {
    return items
  }
  const next = [...items]
  const [moved] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, moved)
  return next
}

export function DockerMirrorsSection({
  mirrors,
  allowInsecureRegistries,
  mirrorsSaving,
  setMirrors,
  setAllowInsecureRegistries,
  saveDockerMirrors,
  onOpenHelp,
}: {
  mirrors: string[]
  allowInsecureRegistries: boolean
  mirrorsSaving: boolean
  setMirrors: React.Dispatch<React.SetStateAction<string[]>>
  setAllowInsecureRegistries: React.Dispatch<React.SetStateAction<boolean>>
  saveDockerMirrors: () => void
  onOpenHelp?: () => void
}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [quickAddLoading, setQuickAddLoading] = useState(false)
  const [testStates, setTestStates] = useState<Record<number, TestState>>({})
  const testAbortRef = useRef<Record<number, AbortController>>({})

  const handleQuickAdd = useCallback(async () => {
    setQuickAddLoading(true)
    try {
      const res = await fetch(MIRRORS_QUICK_ADD_URL)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      const remoteMirrors: string[] = Array.isArray(data) ? data : Array.isArray(data?.mirrors) ? data.mirrors : []
      if (remoteMirrors.length === 0) return
      const normalized = remoteMirrors.map(u => {
        const trimmed = u.trim()
        if (!trimmed) return ''
        // prepend https:// if no protocol present
        return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
      }).filter(Boolean)
      setMirrors(prev => {
        const existing = new Set(prev.filter(Boolean))
        const toAdd = normalized.filter(u => !existing.has(u))
        return [...prev, ...toAdd]
      })
    } catch {
      // silently fail — user can still add manually
    } finally {
      setQuickAddLoading(false)
    }
  }, [setMirrors])

  const handleTestMirror = useCallback(async (index: number, url: string) => {
    if (!url) return
    // abort any in-flight test for this index
    testAbortRef.current[index]?.abort()
    const controller = new AbortController()
    testAbortRef.current[index] = controller

    setTestStates(prev => ({ ...prev, [index]: 'testing' }))
    const ok = await testMirrorUrl(url)
    if (!controller.signal.aborted) {
      setTestStates(prev => ({ ...prev, [index]: ok ? 'success' : 'error' }))
    }
  }, [])

  const testIcon = (state: TestState) => {
    switch (state) {
      case 'testing':
        return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      case 'success':
        return <CheckCircle2 className="h-4 w-4 text-green-600" />
      case 'error':
        return <XCircle className="h-4 w-4 text-red-500" />
      default:
        return null
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle>Docker Mirrors</CardTitle>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Open Docker Mirrors help"
            onClick={onOpenHelp}
          >
            <HelpCircle className="h-4 w-4" />
          </Button>
        </div>
        <CardDescription>
          Speeds up AppOS image pulls during deployment and update. Does not change server Docker
          settings.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label className="text-sm font-medium">Pull Sources</Label>
              <p className="text-sm text-muted-foreground">
                Ordered endpoints AppOS will try first when pulling public images.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={quickAddLoading}
                onClick={handleQuickAdd}
              >
                {quickAddLoading ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="mr-1 h-3.5 w-3.5" />
                )}
                Quick Add
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setMirrors(m => [...m, ''])}
              >
                <Plus className="mr-1 h-3.5 w-3.5" /> Add
              </Button>
            </div>
          </div>
          <div className="overflow-hidden rounded-md border bg-background">
            {mirrors.length === 0 ? (
              <div className="px-3 py-4 text-sm text-muted-foreground">
                No pull sources configured. Click Add to create the first source, or Quick Add to
                fetch community mirrors.
              </div>
            ) : (
              mirrors.map((url, i) => (
                <div
                  key={i}
                  className={`flex items-center gap-2 px-3 py-2 ${i > 0 ? 'border-t' : ''} ${dragIndex === i ? 'opacity-60' : ''}`}
                  onDragOver={event => event.preventDefault()}
                  onDrop={event => {
                    event.preventDefault()
                    if (dragIndex === null) return
                    setMirrors(current => moveListItem(current, dragIndex, i))
                    setDragIndex(null)
                  }}
                >
                  <button
                    type="button"
                    draggable
                    aria-label={`Drag pull source ${i + 1}`}
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    onDragStart={() => setDragIndex(i)}
                    onDragEnd={() => setDragIndex(null)}
                  >
                    <GripVertical className="h-4 w-4" />
                  </button>
                  <Input
                    value={url}
                    onChange={e =>
                      setMirrors(m => m.map((v, idx) => (idx === i ? e.target.value : v)))
                    }
                    placeholder="https://mirror.example.com"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="shrink-0"
                    disabled={testStates[i] === 'testing'}
                    onClick={() => handleTestMirror(i, url)}
                    aria-label={`Test pull source ${i + 1}`}
                  >
                    {testIcon(testStates[i]) || (
                      <span className="text-xs text-muted-foreground">Test</span>
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="shrink-0"
                    onClick={() => {
                      testAbortRef.current[i]?.abort()
                      setMirrors(m => m.filter((_, idx) => idx !== i))
                      setTestStates(prev => {
                        const next = { ...prev }
                        delete next[i]
                        return next
                      })
                    }}
                    aria-label={`Remove pull source ${i + 1}`}
                  >
                    <Trash2 className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </div>
              ))
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Quick Add fetches community-maintained mirrors. Test each source before saving
            — results are for reference only.
          </p>
        </div>

        <div className="space-y-2 border-t pt-4">
          <div className="flex items-center gap-3">
            <Toggle
              id="docker-allow-insecure-registries"
              checked={allowInsecureRegistries}
              onChange={setAllowInsecureRegistries}
            />
            <Label htmlFor="docker-allow-insecure-registries">Allow Insecure Registries</Label>
          </div>
          <p className="pl-11 text-sm text-muted-foreground">
            Allow AppOS to pull from insecure registries when a mirror or upstream endpoint requires
            it.
          </p>
        </div>

        <SaveButton onClick={saveDockerMirrors} saving={mirrorsSaving} />
      </CardContent>
    </Card>
  )
}
