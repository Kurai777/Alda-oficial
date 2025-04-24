import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import {
  ChevronDown,
  Bell,
  Menu,
  User
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function Navigation() {
  const { user, logout } = useAuth();
  const [location] = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navItems = [
    { name: "Dashboard", path: "/" },
    { name: "Catálogos", path: "/catalogs" },
    { name: "Orçamentos", path: "/quotes" },
    { name: "Moodboards", path: "/moodboards" },
    { name: "Design com IA", path: "/ai-design" },
  ];

  return (
    <nav className="bg-white shadow-sm z-10">
      <div className="max-w-8xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex">
            <div className="flex-shrink-0 flex items-center">
              <Link href="/">
                <span className="text-primary-500 text-2xl font-bold cursor-pointer">Ald-a</span>
              </Link>
            </div>
            <div className="hidden sm:ml-6 sm:flex sm:space-x-8">
              {navItems.map((item) => (
                <Link key={item.path} href={item.path}>
                  <span
                    className={`${
                      location === item.path
                        ? "border-primary-500 text-gray-900"
                        : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
                    } inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium cursor-pointer`}
                  >
                    {item.name}
                  </span>
                </Link>
              ))}
            </div>
          </div>
          <div className="hidden sm:ml-6 sm:flex sm:items-center">
            <Button variant="ghost" size="icon" className="mr-2">
              <Bell className="h-5 w-5" />
            </Button>
            
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="flex items-center gap-2">
                  {user?.photoURL ? (
                    <img 
                      src={user.photoURL} 
                      alt={user.companyName || 'Usuário'} 
                      className="h-8 w-8 rounded-full object-cover"
                    />
                  ) : (
                    <div className="h-8 w-8 rounded-full bg-primary-100 flex items-center justify-center text-primary-600">
                      <User className="h-4 w-4" />
                    </div>
                  )}
                  <span className="text-sm font-medium text-gray-700 max-w-[150px] truncate">
                    {user?.companyName}
                  </span>
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <Link href="/profile">Perfil</Link>
                </DropdownMenuItem>
                <DropdownMenuItem>Configurações</DropdownMenuItem>
                <DropdownMenuItem onClick={logout}>Sair</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          
          <div className="-mr-2 flex items-center sm:hidden">
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              <Menu className="h-6 w-6" />
            </Button>
          </div>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileMenuOpen && (
        <div className="sm:hidden">
          <div className="pt-2 pb-3 space-y-1">
            {navItems.map((item) => (
              <Link key={item.path} href={item.path}>
                <span
                  className={`${
                    location === item.path
                      ? "bg-primary-50 border-primary-500 text-primary-700"
                      : "border-transparent text-gray-600 hover:bg-gray-50 hover:border-gray-300 hover:text-gray-800"
                  } block pl-3 pr-4 py-2 border-l-4 text-base font-medium cursor-pointer`}
                  onClick={() => setMobileMenuOpen(false)}
                >
                  {item.name}
                </span>
              </Link>
            ))}
          </div>
          <div className="pt-4 pb-3 border-t border-gray-200">
            <div className="flex items-center px-4">
              <div className="flex-shrink-0">
                {user?.photoURL ? (
                  <img 
                    src={user.photoURL} 
                    alt={user.companyName || 'Usuário'} 
                    className="h-10 w-10 rounded-full object-cover"
                  />
                ) : (
                  <div className="h-10 w-10 rounded-full bg-primary-100 flex items-center justify-center text-primary-600">
                    <User className="h-6 w-6" />
                  </div>
                )}
              </div>
              <div className="ml-3">
                <div className="text-base font-medium text-gray-800">{user?.companyName}</div>
                <div className="text-sm font-medium text-gray-500">{user?.email}</div>
              </div>
              <Button variant="ghost" size="icon" className="ml-auto">
                <Bell className="h-6 w-6" />
              </Button>
            </div>
            <div className="mt-3 space-y-1">
              <Link href="/profile" className="block px-4 py-2 text-base font-medium text-gray-500 hover:text-gray-800 hover:bg-gray-100">
                Perfil
              </Link>
              <a href="#" className="block px-4 py-2 text-base font-medium text-gray-500 hover:text-gray-800 hover:bg-gray-100">
                Configurações
              </a>
              <button
                onClick={logout}
                className="w-full text-left block px-4 py-2 text-base font-medium text-gray-500 hover:text-gray-800 hover:bg-gray-100"
              >
                Sair
              </button>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
