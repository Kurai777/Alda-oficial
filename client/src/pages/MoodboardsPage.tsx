import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { Link } from 'react-router-dom'; // Para o botão "Novo Moodboard"
import { Moodboard } from '@shared/schema'; // Importar o tipo

// Função para buscar os moodboards da API
const fetchMoodboards = async (): Promise<Moodboard[]> => {
  const { data } = await axios.get<Moodboard[]>('/api/moodboards'); // Ajustado para /api/moodboards
  return data;
};

const MoodboardsPage: React.FC = () => {
  const queryClient = useQueryClient();

  const { data: moodboards, isLoading, error, isError } = useQuery<Moodboard[], Error>({
    queryKey: ['moodboards'], 
    queryFn: fetchMoodboards, 
  });

  const errorMessage = error instanceof Error ? error.message : 'Um erro desconhecido ocorreu';

  return (
    <div className="container mx-auto p-4 md:p-6 lg:p-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl md:text-3xl font-bold text-gray-800">Meus Moodboards</h1>
        {/* Botão para futura página de criação */}
        <Link 
          to="/moodboards/new" // Rota placeholder, ajustaremos depois
          className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded transition duration-150 ease-in-out"
        >
          + Novo Moodboard
        </Link>
      </div>

      {isLoading && (
        <div className="text-center text-gray-500">
          <p>Carregando moodboards...</p>
          {/* Poderíamos adicionar um spinner aqui */}
        </div>
      )}

      {isError && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative" role="alert">
          <strong className="font-bold">Erro!</strong>
          <span className="block sm:inline"> Não foi possível carregar os moodboards: {errorMessage}</span>
        </div>
      )}

      {!isLoading && !isError && Array.isArray(moodboards) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {moodboards.length > 0 ? (
            moodboards.map((moodboard: Moodboard) => (
              <div key={moodboard.id} className="border rounded-lg p-4 shadow hover:shadow-md transition-shadow duration-200 bg-white">
                <h2 className="text-lg font-semibold text-gray-700 mb-2 truncate">{moodboard.projectName}</h2>
                <p className="text-sm text-gray-500 mb-1">Cliente: {moodboard.clientName || 'Não informado'}</p>
                <p className="text-sm text-gray-500 mb-3">Produtos: {Array.isArray(moodboard.productIds) ? moodboard.productIds.length : 0}</p>
                {/* Adicionar link para visualizar/editar o moodboard futuramente */}
                <Link 
                  to={`/moodboards/${moodboard.id}`} // Rota placeholder para detalhes
                  className="text-blue-500 hover:text-blue-700 text-sm font-medium"
                >
                  Ver Detalhes
                </Link>
              </div>
            ))
          ) : (
            <div className="col-span-full text-center text-gray-500 py-10">
              <p>Você ainda não criou nenhum moodboard.</p>
            </div>
          )}
        </div>
      )}

      {!isLoading && !isError && !Array.isArray(moodboards) && moodboards && (
         <div className="text-center text-gray-500">
            <p>Recebido formato inesperado de dados.</p>
        </div>
      )}

    </div>
  );
};

export default MoodboardsPage; 