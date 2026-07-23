import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { User, LogOut, Settings } from 'lucide-react'

export function UserMenu() {
  const { t } = useTranslation('navigation')
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [loggingOut, setLoggingOut] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)

  const handleLogout = () => {
    setLoggingOut(true)
    setTimeout(() => {
      logout()
      navigate({ to: '/login' })
    }, 800)
  }

  const isSuperuser = user?.collectionName === '_superusers'

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={t('shell.userMenu')}>
            <User className="h-5 w-5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <div className="px-2 py-1.5 text-sm">
            <p className="font-medium truncate">{user?.email}</p>
            <p className="text-xs text-muted-foreground">
              {isSuperuser ? t('shell.superuser') : t('shell.user')}
            </p>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => navigate({ to: '/profile' })}>
            <Settings className="mr-2 h-4 w-4" />
            {t('shell.profile')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setDialogOpen(true)}>
            <LogOut className="mr-2 h-4 w-4" />
            {t('shell.logout')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog
        open={dialogOpen}
        onOpenChange={open => {
          if (!loggingOut) setDialogOpen(open)
        }}
      >
        <AlertDialogContent>
          {loggingOut ? (
            <div className="py-6 text-center">
              <div className="mb-3 text-3xl">✅</div>
              <p className="text-lg font-medium">{t('shell.logoutSuccess')}</p>
              <p className="text-sm text-muted-foreground mt-1">{t('shell.redirectingToLogin')}</p>
            </div>
          ) : (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>{t('shell.logoutConfirmTitle')}</AlertDialogTitle>
                <AlertDialogDescription>{t('shell.logoutConfirmDescription')}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t('common:cancel')}</AlertDialogCancel>
                <AlertDialogAction onClick={handleLogout}>{t('common:confirm')}</AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
