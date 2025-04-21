import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";

const categories = [
  "Sofás",
  "Cadeiras",
  "Mesas",
  "Armários",
  "Estantes",
  "Camas",
  "Poltronas",
  "Iluminação",
  "Acessórios",
];

const colors = [
  { name: "Branco", value: "white", bg: "bg-white" },
  { name: "Preto", value: "black", bg: "bg-gray-800" },
  { name: "Marrom", value: "brown", bg: "bg-yellow-700" },
  { name: "Vermelho", value: "red", bg: "bg-red-600" },
  { name: "Verde", value: "green", bg: "bg-green-600" },
  { name: "Azul", value: "blue", bg: "bg-blue-600" },
  { name: "Roxo", value: "purple", bg: "bg-purple-600" },
  { name: "Rosa", value: "pink", bg: "bg-pink-600" },
];

const materials = [
  "Madeira",
  "Metal",
  "Vidro",
  "Tecido",
  "Couro",
  "MDF",
  "Plástico",
];

interface FilterSidebarProps {
  onFiltersChange?: (filters: any) => void;
}

export default function FilterSidebar({ onFiltersChange }: FilterSidebarProps) {
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedColors, setSelectedColors] = useState<string[]>([]);
  const [selectedMaterials, setSelectedMaterials] = useState<string[]>([]);
  const [priceRange, setPriceRange] = useState<[number, number]>([0, 5000]);
  const [showAllCategories, setShowAllCategories] = useState(false);

  const handleCategoryChange = (category: string) => {
    setSelectedCategories(prev => 
      prev.includes(category) 
        ? prev.filter(c => c !== category) 
        : [...prev, category]
    );
  };

  const handleColorChange = (color: string) => {
    setSelectedColors(prev => 
      prev.includes(color) 
        ? prev.filter(c => c !== color) 
        : [...prev, color]
    );
  };

  const handleMaterialChange = (material: string) => {
    setSelectedMaterials(prev => 
      prev.includes(material) 
        ? prev.filter(m => m !== material) 
        : [...prev, material]
    );
  };

  const handlePriceChange = (values: number[]) => {
    setPriceRange([values[0], values[1]]);
  };

  const handleApplyFilters = () => {
    if (onFiltersChange) {
      onFiltersChange({
        categories: selectedCategories,
        colors: selectedColors,
        materials: selectedMaterials,
        priceRange,
      });
    }
  };

  const handleClearFilters = () => {
    setSelectedCategories([]);
    setSelectedColors([]);
    setSelectedMaterials([]);
    setPriceRange([0, 5000]);
    
    if (onFiltersChange) {
      onFiltersChange({
        categories: [],
        colors: [],
        materials: [],
        priceRange: [0, 5000],
      });
    }
  };

  const displayedCategories = showAllCategories 
    ? categories 
    : categories.slice(0, 5);

  return (
    <div className="w-full md:w-64 bg-white shadow-md md:shadow-none p-4 md:h-[calc(100vh-4rem)] md:overflow-y-auto">
      <div className="md:sticky md:top-4">
        <h2 className="text-lg font-semibold mb-4">Filtros</h2>
        
        <div className="mb-4">
          <h3 className="font-medium text-sm mb-2 text-gray-700">Categorias</h3>
          <div className="space-y-2">
            {displayedCategories.map((category) => (
              <div key={category} className="flex items-center">
                <Checkbox 
                  id={`category-${category}`}
                  checked={selectedCategories.includes(category)}
                  onCheckedChange={() => handleCategoryChange(category)}
                />
                <Label 
                  htmlFor={`category-${category}`}
                  className="ml-2 text-sm"
                >
                  {category}
                </Label>
              </div>
            ))}
            {categories.length > 5 && (
              <Button 
                variant="link" 
                size="sm" 
                className="p-0 h-auto text-xs text-primary-500 hover:text-primary-600 font-medium"
                onClick={() => setShowAllCategories(!showAllCategories)}
              >
                {showAllCategories ? 'Ver menos' : 'Ver todas'}
              </Button>
            )}
          </div>
        </div>
        
        <div className="mb-4">
          <h3 className="font-medium text-sm mb-2 text-gray-700">Cores</h3>
          <div className="flex flex-wrap gap-2">
            {colors.map((color) => (
              <button
                key={color.value}
                className={`w-6 h-6 rounded-full ${color.bg} focus:outline-none ${
                  selectedColors.includes(color.value) 
                    ? 'ring-2 ring-primary-500' 
                    : 'border border-gray-300'
                }`}
                title={color.name}
                onClick={() => handleColorChange(color.value)}
              ></button>
            ))}
          </div>
        </div>
        
        <div className="mb-4">
          <h3 className="font-medium text-sm mb-2 text-gray-700">Faixa de Preço</h3>
          <div className="space-y-4">
            <div className="flex space-x-2">
              <div className="flex-1">
                <Input 
                  type="number" 
                  placeholder="Min" 
                  value={priceRange[0]}
                  onChange={(e) => setPriceRange([Number(e.target.value), priceRange[1]])}
                  min={0}
                  className="w-full"
                />
              </div>
              <div className="flex-1">
                <Input 
                  type="number" 
                  placeholder="Max" 
                  value={priceRange[1]}
                  onChange={(e) => setPriceRange([priceRange[0], Number(e.target.value)])}
                  min={0}
                  className="w-full"
                />
              </div>
            </div>
            <Slider
              value={[priceRange[0], priceRange[1]]}
              min={0}
              max={5000}
              step={50}
              onValueChange={handlePriceChange}
              className="w-full"
            />
          </div>
        </div>
        
        <div className="mb-4">
          <h3 className="font-medium text-sm mb-2 text-gray-700">Material</h3>
          <div className="space-y-2">
            {materials.map((material) => (
              <div key={material} className="flex items-center">
                <Checkbox 
                  id={`material-${material}`}
                  checked={selectedMaterials.includes(material)}
                  onCheckedChange={() => handleMaterialChange(material)}
                />
                <Label 
                  htmlFor={`material-${material}`}
                  className="ml-2 text-sm"
                >
                  {material}
                </Label>
              </div>
            ))}
          </div>
        </div>
        
        <div>
          <Button 
            variant="secondary" 
            className="w-full bg-primary-100 text-primary-600 hover:bg-primary-200 font-medium"
            onClick={handleApplyFilters}
          >
            Aplicar Filtros
          </Button>
          <Button 
            variant="ghost" 
            className="w-full text-gray-500 mt-2" 
            onClick={handleClearFilters}
          >
            Limpar Filtros
          </Button>
        </div>
      </div>
    </div>
  );
}
