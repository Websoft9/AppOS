import { useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { useAuth } from "@/contexts/AuthContext"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { User, LogOut } from "lucide-react"

export function UserMenu() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [loggingOut, setLoggingOut] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)

  const handleLogout = () => {
    setLoggingOut(true)
    setTimeout(() => {
      logout()
      navigate({ to: "/login" })
    }, 800)
  }

  const isSuperuser = user?.collectionName === "_superusers"

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="User menu">
            <User className="h-5 w-5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <div className="px-2 py-1.5 text-sm">
            <p className="font-medium truncate">{user?.email}</p>
            <p className="text-xs text-muted-foreground">
              {isSuperuser ? "Superuser" : "User"}
            </p>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setDialogOpen(true)}>
            <LogOut className="mr-2 h-4 w-4" />
            Logout
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={dialogOpen} onOpenChange={(open) => { if (!loggingOut) setDialogOpen(open) }}>
        <AlertDialogContent>
          {loggingOut ? (
            <div className="py-6 text-center">
              <div className="mb-3 text-3xl">✅</div>
              <p className="text-lg font-medium">Successfully logged out</p>
              <p className="text-sm text-muted-foreground mt-1">Redirecting to login...</p>
            </div>
          ) : (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Logout</AlertDialogTitle>
                <AlertDialogDescription>
                  Are you sure you want to exit the AppOS console?
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleLogout}>Confirm</AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
