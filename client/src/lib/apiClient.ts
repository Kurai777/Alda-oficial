import type { DesignProject, DesignProjectItem } from '@shared/schema'; // Idealmente, usaríamos estes tipos

// Tipos mock temporários para alinhar com o frontend atual (DesignAiProjectPage.tsx)
// TODO: Alinhar frontend para usar os tipos reais de @shared/schema

// ADICIONANDO MockDesignProjectSummary AQUI PARA RESOLVER LINTER ERROR
type MockDesignProjectSummary = {
  id: number;
  name: string;
  status: string; // Simplificado para a lista
  // Adicionar talvez uma data ou thumbnail se útil para a lista de projetos
  clientRenderImageUrl?: string | null; // Adicionado para possível thumbnail
  createdAt?: string | Date; // Adicionado para possível ordenação/exibição
};

type MockProductSummary = {
  id: number;
  name: string;
  imageUrl: string | null;
};

type MockDesignProjectItem = {
  id: number;
  designProjectId: number;
  detectedObjectName?: string | null; // Adicionado no schema
  detectedObjectDescription: string;
  detectedObjectBoundingBox: any | null;
  suggestedProductId1: number | null;
  suggestedProduct1Details: MockProductSummary | null;
  matchScore1: number | null;
  suggestedProductId2: number | null;
  suggestedProduct2Details: MockProductSummary | null;
  matchScore2: number | null;
  suggestedProductId3: number | null;
  suggestedProduct3Details: MockProductSummary | null;
  matchScore3: number | null;
  selectedProductId: number | null;
  userFeedback: string | null;
  notes?: string | null; // Adicionado no schema
  generatedInpaintedImageUrl?: string | null; // Adicionado no schema
  createdAt?: string | Date; // Adicionar campos de data se o frontend os espera
  updatedAt?: string | Date;
};

type MockDesignProject = {
  id: number;
  name: string;
  status: 'new' | 'processing' | 'awaiting_selection' | 'processed_no_items' | 'completed' | 'failed' | 'rendering_final';
  clientRenderImageUrl: string | null;
  generatedRenderUrl?: string | null; 
  items?: MockDesignProjectItem[];
  userId?: number; // Adicionar se necessário
  createdAt?: string | Date;
  updatedAt?: string | Date;
};

/**
 * Função para chamar a API de geração de render final.
 * @param projectId O ID do projeto de design.
 * @returns Uma promessa que resolve para a resposta da API.
 */
export const callGenerateFinalRenderApi = async (projectId: number): Promise<{ message: string }> => {
  console.log(`[API Client] Chamando /api/ai-design-projects/${projectId}/generate-final-render`);
  const response = await fetch(`/api/ai-design-projects/${projectId}/generate-final-render`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Cookies de sessão (como connect.sid) devem ser enviados automaticamente pelo navegador
      // se o frontend e o backend estiverem no mesmo domínio ou configurados para CORS com credenciais.
    },
  });

  if (!response.ok) {
    let errorMessage = 'Falha ao iniciar a geração do render.';
    try {
      const errorData = await response.json();
      errorMessage = errorData.message || errorMessage;
    } catch (e) {
      // Se o corpo do erro não for JSON, use o statusText
      errorMessage = response.statusText || errorMessage;
    }
    console.error(`[API Client] Erro na chamada para generate-final-render: ${response.status} - ${errorMessage}`);
    throw new Error(errorMessage);
  }

  return response.json(); 
};

/**
 * Busca os detalhes de um projeto de design, incluindo seus itens.
 * @param projectId O ID do projeto.
 * @returns Uma promessa que resolve para os dados do projeto ou null.
 */
export const getDesignProjectDetailsApi = async (projectId: number): Promise<MockDesignProject | null> => {
  console.log(`[API Client] Buscando detalhes do projeto ID: ${projectId}`);

  try {
    // Etapa 1: Buscar os detalhes base do projeto
    const projectDetailsResponse = await fetch(`/api/ai-design-projects/${projectId}`);

    if (!projectDetailsResponse.ok) {
      if (projectDetailsResponse.status === 404) {
        console.warn(`[API Client] Projeto base ${projectId} não encontrado (404).`);
        return null;
      }
      let errorMessage = 'Falha ao buscar detalhes base do projeto.';
      try {
        const errorData = await projectDetailsResponse.json();
        errorMessage = errorData.message || errorMessage;
      } catch (e) {
        errorMessage = projectDetailsResponse.statusText || errorMessage;
      }
      console.error(`[API Client] Erro ao buscar projeto base ${projectId}: ${projectDetailsResponse.status} - ${errorMessage}`);
      throw new Error(errorMessage);
    }
    const projectBaseData = await projectDetailsResponse.json();

    // Etapa 2: Buscar os itens do projeto
    const projectItemsResponse = await fetch(`/api/ai-design-projects/${projectId}/items`);

    if (!projectItemsResponse.ok) {
      // Não considerar 404 como erro fatal para itens, projeto pode não ter itens.
      // No entanto, outros erros devem ser tratados.
      if (projectItemsResponse.status !== 404) {
        let errorMessage = 'Falha ao buscar itens do projeto.';
        try {
          const errorData = await projectItemsResponse.json();
          errorMessage = errorData.message || errorMessage;
        } catch (e) {
          errorMessage = projectItemsResponse.statusText || errorMessage;
        }
        console.error(`[API Client] Erro ao buscar itens para o projeto ${projectId}: ${projectItemsResponse.status} - ${errorMessage}`);
        throw new Error(errorMessage);
      }
      // Se for 404 para itens, apenas significa que não há itens, o que é ok.
    }

    const itemsData = projectItemsResponse.ok ? await projectItemsResponse.json() : [];

    // Etapa 3: Combinar os dados
    const combinedData: MockDesignProject = {
      ...(projectBaseData as MockDesignProject), // Assume que projectBaseData tem a estrutura de MockDesignProject (sem items)
      items: itemsData as MockDesignProjectItem[] // Adiciona os items
    };

    console.log("[API Client] Dados combinados para projeto:", combinedData);
    return combinedData;

  } catch (error) {
    // Se qualquer uma das chamadas fetch falhar e lançar um erro, ele será pego aqui.
    console.error(`[API Client] Erro geral em getDesignProjectDetailsApi para projeto ${projectId}:`, error);
    // Retornar null ou relançar o erro, dependendo de como o chamador deve tratar.
    // Por consistência com o comportamento anterior de 404, retornar null pode ser apropriado.
    return null; 
  }
};

/**
 * Atualiza um item específico do projeto de design.
 * @param projectId O ID do projeto.
 * @param itemId O ID do item a ser atualizado.
 * @param updateData Os dados para atualizar o item (ex: { selectedProductId: number | null, notes: string }).
 * @returns Uma promessa que resolve para o item atualizado.
 */
export const updateDesignProjectItemApi = async (
  projectId: number, 
  itemId: number, 
  updateData: Partial<MockDesignProjectItem> // Usando Mock para consistência com frontend atual
): Promise<MockDesignProjectItem> => {
  console.log(`[API Client] Atualizando item ${itemId} do projeto ${projectId} com dados:`, updateData);
  const response = await fetch(`/api/ai-design-projects/${projectId}/items/${itemId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(updateData),
  });

  if (!response.ok) {
    let errorMessage = 'Falha ao atualizar o item de design.';
    try {
      const errorData = await response.json();
      errorMessage = errorData.message || errorMessage;
    } catch (e) {
      errorMessage = response.statusText || errorMessage;
    }
    console.error(`[API Client] Erro ao atualizar item ${itemId}: ${response.status} - ${errorMessage}`);
    throw new Error(errorMessage);
  }
  return response.json(); 
};

/**
 * Faz upload de uma imagem para um projeto de design AI e dispara a análise.
 * @param projectId O ID do projeto.
 * @param imageFile O arquivo da imagem a ser enviado.
 * @param userMessageText Texto opcional do usuário para acompanhar a imagem.
 * @returns Uma promessa que resolve para os dados do projeto atualizado.
 */
export const uploadProjectImageApi = async (
  projectId: number, 
  imageFile: File,
  userMessageText?: string
): Promise<MockDesignProject> => { // Retornando MockDesignProject para alinhar com o frontend
  console.log(`[API Client] Fazendo upload da imagem ${imageFile.name} para o projeto ${projectId}`);

  const formData = new FormData();
  formData.append('projectImage', imageFile); // 'projectImage' deve corresponder ao esperado pelo Multer no backend
  if (userMessageText) {
    formData.append('userMessageText', userMessageText);
  }

  // Não estamos enviando projectId no corpo do FormData pois ele já está na URL da rota.
  // Se o backend precisasse do projectId no corpo por algum motivo, ele seria adicionado ao FormData aqui.

  const response = await fetch(`/api/ai-design-projects/${projectId}/initiate-image-analysis`, {
    method: 'POST',
    // Não defina 'Content-Type': 'multipart/form-data' explicitamente com fetch e FormData.
    // O navegador define isso automaticamente com o boundary correto.
    body: formData,
  });

  if (!response.ok) {
    let errorMessage = 'Falha ao fazer upload da imagem ou iniciar análise.';
    try {
      const errorData = await response.json();
      errorMessage = errorData.message || errorMessage;
    } catch (e) {
      errorMessage = response.statusText || errorMessage;
    }
    console.error(`[API Client] Erro no upload/análise para projeto ${projectId}: ${response.status} - ${errorMessage}`);
    throw new Error(errorMessage);
  }
  return response.json(); 
};

/**
 * Busca os detalhes de múltiplos produtos de uma vez.
 * @param productIds Array com os IDs dos produtos a serem buscados.
 * @returns Uma promessa que resolve para um mapa de ID de produto para detalhes do produto.
 */
export const getProductsDetailsApi = async (productIds: number[]): Promise<Record<number, MockProductSummary>> => {
  if (!productIds || productIds.length === 0) {
    return {}; // Retorna objeto vazio se não houver IDs
  }
  // Converter array de IDs para string separada por vírgulas
  const idsString = productIds.join(',');
  console.log(`[API Client] Buscando detalhes dos produtos em batch para IDs: ${idsString}`);
  
  const response = await fetch(`/api/products/batch?ids=${idsString}`);

  if (!response.ok) {
    let errorMessage = 'Falha ao buscar detalhes dos produtos em batch.';
    try {
      const errorData = await response.json();
      errorMessage = errorData.message || errorMessage;
    } catch (e) {
      errorMessage = response.statusText || errorMessage;
    }
    console.error(`[API Client] Erro ao buscar produtos em batch: ${response.status} - ${errorMessage}`);
    throw new Error(errorMessage);
  }
  // A resposta da API é Record<number, Product>, mas o frontend espera Record<number, MockProductSummary>
  // Precisamos garantir que os campos correspondam ou fazer uma transformação aqui.
  // Por agora, vamos assumir que Product tem pelo menos id, name, imageUrl.
  const productsMap: Record<number, any> = await response.json();
  const mockProductsMap: Record<number, MockProductSummary> = {};

  for (const id in productsMap) {
    if (Object.prototype.hasOwnProperty.call(productsMap, id)) {
      const product = productsMap[id];
      mockProductsMap[id] = {
        id: product.id,
        name: product.name,
        imageUrl: product.imageUrl || null 
      };
    }
  }
  return mockProductsMap;
};

/**
 * Busca a lista de todos os projetos de design AI para o usuário logado.
 * @returns Uma promessa que resolve para um array de sumários de projetos de design.
 */
export const getDesignProjectsListApi = async (): Promise<MockDesignProjectSummary[]> => {
  console.log("[API Client] Buscando lista de projetos de design AI...");
  const response = await fetch(`/api/ai-design-projects`);

  if (!response.ok) {
    let errorMessage = 'Falha ao buscar a lista de projetos de design.';
    try {
      const errorData = await response.json();
      errorMessage = errorData.message || errorMessage;
    } catch (e) {
      errorMessage = response.statusText || errorMessage;
    }
    console.error(`[API Client] Erro ao buscar lista de projetos de design: ${response.status} - ${errorMessage}`);
    throw new Error(errorMessage);
  }
  
  const projectsData: DesignProject[] = await response.json(); // A API retorna DesignProject[]
  
  // Mapear para MockDesignProjectSummary para compatibilidade com a UI atual de design-ai.tsx
  // Idealmente, design-ai.tsx usaria DesignProject ou um tipo de sumário mais completo.
  const mockSummaries: MockDesignProjectSummary[] = projectsData.map(project => ({
    id: project.id,
    name: project.name,
    status: project.status, // Assumindo que DesignProject tem 'status'
    // Adicionar outros campos se MockDesignProjectSummary evoluir
  }));
  
  return mockSummaries;
};

// Adicione outras funções de chamada de API aqui no futuro, se necessário. 

/**
 * Cria um novo projeto de design AI.
 * @param projectData Os dados para criar o projeto (ex: { name: string }).
 * @returns Uma promessa que resolve para o projeto criado.
 */
export const createDesignProjectApi = async (
  projectDataInput: { name: string; clientRenderImageUrl?: string | null; clientFloorPlanImageUrl?: string | null }
): Promise<MockDesignProject> => { 
  console.log("[API Client] createDesignProjectApi chamada com (projectDataInput):", projectDataInput);

  // Forçar a estrutura correta do payload aqui para garantir
  const payload = {
    name: projectDataInput.name, // Garante que a propriedade é 'name'
    clientRenderImageUrl: projectDataInput.clientRenderImageUrl,
    clientFloorPlanImageUrl: projectDataInput.clientFloorPlanImageUrl
  };
  // Remover chaves opcionais se forem undefined para não enviar "key: undefined"
  if (payload.clientRenderImageUrl === undefined) delete payload.clientRenderImageUrl;
  if (payload.clientFloorPlanImageUrl === undefined) delete payload.clientFloorPlanImageUrl;

  console.log("[API Client] Payload que será enviado (payload):", payload);

  const response = await fetch(`/api/ai-design-projects`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload), // Usar o payload explicitamente construído
  });

  if (!response.ok) {
    let errorMessage = 'Falha ao criar o projeto de design.';
    try {
      const errorData = await response.json();
      errorMessage = errorData.message || errorMessage;
    } catch (e) {
      errorMessage = response.statusText || errorMessage;
    }
    console.error(`[API Client] Erro ao criar projeto de design: ${response.status} - ${errorMessage}`);
    throw new Error(errorMessage);
  }
  return response.json(); 
}; 