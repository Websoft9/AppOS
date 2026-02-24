import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { StickyNote } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import type { UserApp } from '@/lib/store-user-api'

interface NoteEditorProps {
  appKey: string
  userApps: UserApp[]
  onSave: (appKey: string, note: string | null) => void
  isSaving?: boolean
}

export function NoteEditor({ appKey, userApps, onSave, isSaving }: NoteEditorProps) {
  const { t } = useTranslation('store')
  const noteValue = userApps.find((a) => a.app_key === appKey)?.note ?? null
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [expanded, setExpanded] = useState(false)

  const openEditor = () => {
    setDraft(noteValue ?? '')
    setEditing(true)
    setExpanded(false)
  }

  const handleSave = () => {
    onSave(appKey, draft.trim() || null)
    setEditing(false)
  }

  const handleCancel = () => {
    setEditing(false)
    setDraft('')
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <StickyNote
          className={cn('h-4 w-4 shrink-0', noteValue ? 'fill-yellow-400 text-yellow-500' : 'text-muted-foreground')}
        />
        <span className="text-sm font-semibold">{t('note.label')}</span>
        {!editing && (
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs ml-auto" onClick={openEditor}>
            {noteValue ? t('note.edit') : t('note.add')}
          </Button>
        )}
      </div>

      {editing ? (
        <div className="space-y-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t('note.placeholder')}
            className="text-sm min-h-[80px] resize-none"
            autoFocus
          />
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" size="sm" onClick={handleCancel} disabled={isSaving}>
              {t('note.cancel')}
            </Button>
            <Button size="sm" onClick={handleSave} disabled={isSaving}>
              {t('note.save')}
            </Button>
          </div>
        </div>
      ) : noteValue ? (
        <div>
          <p className={cn('text-sm text-muted-foreground whitespace-pre-wrap', !expanded && 'line-clamp-3')}>
            {noteValue}
          </p>
          {!expanded && noteValue.length > 150 && (
            <button className="text-xs text-primary mt-1 hover:underline" onClick={() => setExpanded(true)}>
              {t('note.showMore')}
            </button>
          )}
        </div>
      ) : null}
    </div>
  )
}
