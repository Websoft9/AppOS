import { createFileRoute } from '@tanstack/react-router'

function DashboardPage() {
  return (
    <div>
      <h2 className="text-2xl font-bold mb-4">Dashboard</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="bg-card text-card-foreground p-6 rounded-lg border">
          <h3 className="text-lg font-semibold mb-2">Applications</h3>
          <p className="text-3xl font-bold text-primary">0</p>
          <p className="text-sm text-muted-foreground mt-2">Active applications</p>
        </div>
        <div className="bg-card text-card-foreground p-6 rounded-lg border">
          <h3 className="text-lg font-semibold mb-2">Services</h3>
          <p className="text-3xl font-bold text-primary">0</p>
          <p className="text-sm text-muted-foreground mt-2">Running services</p>
        </div>
        <div className="bg-card text-card-foreground p-6 rounded-lg border">
          <h3 className="text-lg font-semibold mb-2">Resources</h3>
          <p className="text-3xl font-bold text-primary">0</p>
          <p className="text-sm text-muted-foreground mt-2">Total resources</p>
        </div>
      </div>
    </div>
  )
}

export const Route = createFileRoute('/_app/_auth/dashboard')({
  component: DashboardPage,
})
