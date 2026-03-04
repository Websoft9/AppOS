import { useState, useEffect } from 'react'
import { Languages } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { setLocale, getLocale } from '@/lib/i18n'

const LANG_LABELS: Record<string, string> = {
  en: 'EN',
  zh: '中文',
}

export function LanguageSwitcher() {
  const [lang, setLang] = useState<'en' | 'zh'>(getLocale)

  useEffect(() => {
    setLang(getLocale())
  }, [])

  const handleChange = (value: string) => {
    const next = value as 'en' | 'zh'
    setLocale(next)
    setLang(next)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 px-2 text-xs font-medium"
          aria-label="Change language"
        >
          <Languages className="h-4 w-4" />
          <span className="hidden sm:inline">{LANG_LABELS[lang]}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[100px]">
        <DropdownMenuRadioGroup value={lang} onValueChange={handleChange}>
          <DropdownMenuRadioItem value="en">English</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="zh">中文</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
