import { Settings2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { IconBreadcrumb } from '@/components/layout/IconBreadcrumb'

export function SettingsBreadcrumb({ currentPage }: { currentPage: string }) {
  const { t } = useTranslation('navigation')

  return (
    <IconBreadcrumb
      icon={<Settings2 className="h-4 w-4" />}
      parentLabel={t('items.settings')}
      parentHref="/settings"
      currentPage={currentPage}
    />
  )
}