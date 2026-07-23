import {
  Activity,
  Boxes,
  Clock3,
  Database,
  FileCode2,
  KeyRound,
  LayoutDashboard,
  ScrollText,
  Settings2,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { TabsList, TabsTrigger } from '@/components/ui/tabs'

const APP_DETAIL_TABS = [
  { value: 'overview', key: 'overview', fallback: 'Overview', icon: LayoutDashboard },
  { value: 'access', key: 'access', fallback: 'Access', icon: KeyRound },
  { value: 'actions', key: 'activity', fallback: 'Activity', icon: ScrollText },
  { value: 'runtime', key: 'runtime', fallback: 'Runtime', icon: Boxes },
  { value: 'compose', key: 'compose', fallback: 'Compose', icon: FileCode2 },
  {
    value: 'observability',
    key: 'observability',
    fallback: 'Observability',
    icon: Activity,
  },
  { value: 'data', key: 'data', fallback: 'Data', icon: Database },
  { value: 'automation', key: 'automation', fallback: 'Automation', icon: Clock3 },
  { value: 'settings', key: 'settings', fallback: 'Settings', icon: Settings2 },
] as const

export function AppDetailTabRail() {
  const { t } = useTranslation('apps')
  return (
    <TabsList variant="line" className="w-full justify-start bg-transparent p-0 md:sticky md:top-4">
      {APP_DETAIL_TABS.map(tab => {
        const Icon = tab.icon
        return (
          <TabsTrigger
            key={tab.value}
            value={tab.value}
            className="min-h-10 rounded-lg border-0 px-4 py-2.5 pl-5 text-left text-sm font-medium text-muted-foreground data-[state=active]:bg-muted/45 data-[state=active]:text-foreground data-[state=active]:shadow-none group-data-[orientation=vertical]/tabs:after:left-1 group-data-[orientation=vertical]/tabs:after:right-auto group-data-[orientation=vertical]/tabs:after:w-0.5 group-data-[orientation=vertical]/tabs:after:rounded-full"
          >
            <Icon className="h-4 w-4" />
            {t(`tabs.${tab.key}`, { defaultValue: tab.fallback })}
          </TabsTrigger>
        )
      })}
    </TabsList>
  )
}
