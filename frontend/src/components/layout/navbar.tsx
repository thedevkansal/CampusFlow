'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Car, Bell, LogOut, LayoutDashboard, Gauge, UserCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { useAuth } from '@/context/auth-context';
import { cn } from '@/lib/utils';

export function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, isAuthenticated, role, logout } = useAuth();

  const handleLogout = () => {
    logout();
    router.push('/login');
  };

  const navLinks = isAuthenticated
    ? role === 'DRIVER'
      ? [
          { href: '/driver', label: 'Dashboard', icon: Gauge },
          { href: '/notifications', label: 'Notifications', icon: Bell },
        ]
      : [
          { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
          { href: '/notifications', label: 'Notifications', icon: Bell },
        ]
    : [];

  // Derive display name — use real name, fallback to email username
  const displayName = user?.name || user?.email?.split('@')[0] || 'Me';
  const initials = displayName.slice(0, 2).toUpperCase();

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/60 bg-background/80 backdrop-blur-md">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between max-w-7xl">
        {/* Logo */}
        <div className="flex items-center gap-8">
          <Link
            href={isAuthenticated ? (role === 'DRIVER' ? '/driver' : '/dashboard') : '/'}
            className="flex items-center gap-2 font-bold text-lg text-primary shrink-0"
          >
            <div className="bg-primary/10 p-1.5 rounded-lg">
              <Car className="h-5 w-5" />
            </div>
            <span className="hidden sm:block">CampusFlow</span>
          </Link>

          {/* Top nav links */}
          {isAuthenticated && navLinks.length > 0 && (
            <nav className="hidden md:flex items-center gap-1">
              {navLinks.map(({ href, label }) => (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    'px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                    pathname === href
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                  )}
                >
                  {label}
                </Link>
              ))}
            </nav>
          )}
        </div>

        {/* Right side */}
        <div className="flex items-center gap-2">
          {isAuthenticated && user ? (
            <DropdownMenu>
              <DropdownMenuTrigger className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <div className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-full hover:bg-muted transition-colors cursor-pointer">
                  <Avatar className="h-8 w-8">
                    <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <span className="hidden sm:block text-sm font-medium text-foreground max-w-[120px] truncate">
                    {displayName}
                  </span>
                </div>
              </DropdownMenuTrigger>

              <DropdownMenuContent className="w-56" align="end">
                {/* Plain div — DropdownMenuLabel requires a Menu.Group wrapper in Base UI */}
                <div className="px-2 py-1.5">
                  <p className="text-sm font-semibold leading-none truncate">{displayName}</p>
                  <p className="text-xs leading-none text-muted-foreground truncate mt-0.5">{user.email}</p>
                </div>

                <DropdownMenuSeparator />

                {/* Profile — uses router.push for reliable Next.js navigation */}
                <DropdownMenuItem
                  className="cursor-pointer"
                  onClick={() => router.push('/profile')}
                >
                  <UserCircle className="mr-2 h-4 w-4" />
                  <span>Profile</span>
                </DropdownMenuItem>

                {/* Role-specific nav links */}
                {navLinks.map(({ href, label, icon: Icon }) => (
                  <DropdownMenuItem
                    key={href}
                    className="cursor-pointer"
                    onClick={() => router.push(href)}
                  >
                    <Icon className="mr-2 h-4 w-4" />
                    <span>{label}</span>
                  </DropdownMenuItem>
                ))}

                <DropdownMenuSeparator />

                <DropdownMenuItem
                  variant="destructive"
                  onClick={handleLogout}
                  className="cursor-pointer"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>Log out</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <div className="flex items-center gap-2">
              <Link href="/login">
                <Button variant="ghost" size="sm">Log in</Button>
              </Link>
              <Link href="/register">
                <Button size="sm">Get Started</Button>
              </Link>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
