import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, LayoutGrid, List } from "lucide-react";

interface SearchSortProps {
  onSearch?: (query: string) => void;
  onSort?: (sortOption: string) => void;
  onViewChange?: (view: 'grid' | 'list') => void;
}

export default function SearchSort({ onSearch, onSort, onViewChange }: SearchSortProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [sortOption, setSortOption] = useState("relevance");
  const [view, setView] = useState<'grid' | 'list'>('grid');

  const handleSearch = () => {
    if (onSearch) {
      onSearch(searchQuery);
    }
  };

  const handleSortChange = (value: string) => {
    setSortOption(value);
    if (onSort) {
      onSort(value);
    }
  };

  const handleViewChange = (newView: 'grid' | 'list') => {
    setView(newView);
    if (onViewChange) {
      onViewChange(newView);
    }
  };

  return (
    <div className="flex flex-col sm:flex-row justify-between items-center mb-6 gap-4">
      <div className="w-full sm:w-96">
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Search className="h-4 w-4 text-gray-400" />
          </div>
          <Input
            type="search"
            placeholder="Buscar por nome, código ou descrição"
            className="pl-10"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          />
        </div>
      </div>
      
      <div className="flex items-center space-x-3 w-full sm:w-auto">
        <span className="text-sm font-medium text-gray-700 whitespace-nowrap">Ordenar por:</span>
        <Select value={sortOption} onValueChange={handleSortChange}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Mais relevantes" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="relevance">Mais relevantes</SelectItem>
            <SelectItem value="price_asc">Preço: Menor para Maior</SelectItem>
            <SelectItem value="price_desc">Preço: Maior para Menor</SelectItem>
            <SelectItem value="name_asc">Nome: A-Z</SelectItem>
            <SelectItem value="name_desc">Nome: Z-A</SelectItem>
            <SelectItem value="newest">Mais recentes</SelectItem>
          </SelectContent>
        </Select>
        
        <div className="border-l border-gray-200 h-6 mx-2 hidden sm:block"></div>
        
        <div className="flex space-x-2 hidden sm:flex">
          <Button
            variant={view === 'grid' ? 'secondary' : 'ghost'}
            size="icon"
            onClick={() => handleViewChange('grid')}
            title="Visualização em grade"
          >
            <LayoutGrid className="h-4 w-4" />
          </Button>
          <Button
            variant={view === 'list' ? 'secondary' : 'ghost'}
            size="icon"
            onClick={() => handleViewChange('list')}
            title="Visualização em lista"
          >
            <List className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
