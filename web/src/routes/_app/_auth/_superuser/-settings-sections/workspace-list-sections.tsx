import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SaveButton } from './shared'

export function DockerMirrorsSection({
  mirrors,
  insecureRegs,
  mirrorsSaving,
  setMirrors,
  setInsecureRegs,
  saveDockerMirrors,
}: {
  mirrors: string[]
  insecureRegs: string[]
  mirrorsSaving: boolean
  setMirrors: React.Dispatch<React.SetStateAction<string[]>>
  setInsecureRegs: React.Dispatch<React.SetStateAction<string[]>>
  saveDockerMirrors: () => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Docker Mirrors</CardTitle>
        <CardDescription>Registry mirror URLs and insecure registries</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">Registry Mirrors</Label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setMirrors(m => [...m, ''])}
            >
              <Plus className="mr-1 h-3.5 w-3.5" /> Add
            </Button>
          </div>
          {mirrors.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No mirrors configured. Click Add to add one.
            </p>
          )}
          {mirrors.map((url, i) => (
            <div key={i} className="flex gap-2">
              <Input
                value={url}
                onChange={e => setMirrors(m => m.map((v, idx) => (idx === i ? e.target.value : v)))}
                placeholder="https://mirror.example.com"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setMirrors(m => m.filter((_, idx) => idx !== i))}
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          ))}
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">Insecure Registries</Label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setInsecureRegs(r => [...r, ''])}
            >
              <Plus className="mr-1 h-3.5 w-3.5" /> Add
            </Button>
          </div>
          {insecureRegs.length === 0 && (
            <p className="text-sm text-muted-foreground">No insecure registries configured.</p>
          )}
          {insecureRegs.map((reg, i) => (
            <div key={i} className="flex gap-2">
              <Input
                value={reg}
                onChange={e =>
                  setInsecureRegs(r => r.map((v, idx) => (idx === i ? e.target.value : v)))
                }
                placeholder="my-registry:5000"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setInsecureRegs(r => r.filter((_, idx) => idx !== i))}
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          ))}
        </div>

        <SaveButton onClick={saveDockerMirrors} saving={mirrorsSaving} />
      </CardContent>
    </Card>
  )
}
