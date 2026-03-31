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
import { TabsList, TabsTrigger } from '@/components/ui/tabs'

const APP_DETAIL_TABS = [
  { value: 'overview', label: 'Overview', icon: LayoutDashboard },
  { value: 'access', label: 'Access', icon: KeyRound },
  { value: 'actions', label: 'Actions', icon: ScrollText },
  { value: 'runtime', label: 'Runtime', icon: Boxes },
  { value: 'compose', label: 'Compose', icon: FileCode2 },
  { value: 'observability', label: 'Observability', icon: Activity },
  { value: 'data', label: 'Data', icon: Database },
  { value: 'automation', label: 'Automation', icon: Clock3 },
  { value: 'settings', label: 'Settings', icon: Settings2 },
] as const

export function AppDetailTabRail() {
  return (
    <TabsList variant="line" className="w-full justify-start rounded-2xl border border-border/60 bg-background/90 p-2 shadow-[0_10px_30px_-20px_rgba(15,23,42,0.28)] backdrop-blur md:sticky md:top-4">
      {APP_DETAIL_TABS.map(tab => {
        const Icon = tab.icon
        return (
          <TabsTrigger
            key={tab.value}
            value={tab.value}
            className="min-h-10 rounded-lg border-0 px-4 py-2.5 pl-5 text-left text-sm font-medium text-muted-foreground data-[state=active]:bg-muted/45 data-[state=active]:text-foreground data-[state=active]:shadow-none group-data-[orientation=vertical]/tabs:after:left-1 group-data-[orientation=vertical]/tabs:after:right-auto group-data-[orientation=vertical]/tabs:after:w-0.5 group-data-[orientation=vertical]/tabs:after:rounded-full"
          >
            <Icon className="h-4 w-4" />
            {tab.label}
          </TabsTrigger>
        )
      })}
    </TabsList>
  )
}