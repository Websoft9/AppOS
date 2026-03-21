import { createFileRoute } from '@tanstack/react-router'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  InstalledComponentsContent,
  ActiveServicesContent,
} from '@/pages/components/ComponentsPage'
import { SystemCronsContent } from './system-tasks'

function StatusPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Status</h1>
        <p className="text-muted-foreground mt-1">
          System component health, active services, and scheduled cron jobs.
        </p>
      </div>
      <Tabs defaultValue="components">
        <TabsList className="mb-1">
          <TabsTrigger value="components">Components</TabsTrigger>
          <TabsTrigger value="services">Active Services</TabsTrigger>
          <TabsTrigger value="crons">System Crons</TabsTrigger>
        </TabsList>
        <TabsContent value="components" className="mt-1">
          <InstalledComponentsContent />
        </TabsContent>
        <TabsContent value="services" className="mt-1">
          <ActiveServicesContent />
        </TabsContent>
        <TabsContent value="crons" className="mt-1">
          <SystemCronsContent />
        </TabsContent>
      </Tabs>
    </div>
  )
}

export const Route = createFileRoute('/_app/_auth/_superuser/status')({
  component: StatusPage,
})

