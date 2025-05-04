import { QueryClient, QueryFunction } from "@tanstack/react-query";

async function throwIfResNotOk(res: Response, responseType: 'json' | 'blob' | 'text' = 'json') {
  if (!res.ok) {
    // Como não podemos clonar a resposta em todos os navegadores, 
    // vamos verificar o tipo esperado antes de tentar ler o corpo
    if (responseType === 'blob') {
      // Para blob, apenas use o statusText
      throw new Error(`${res.status}: ${res.statusText || 'Erro ao processar requisição'}`);
    } else {
      // Para outros tipos, tente ler o corpo da resposta
      try {
        const text = (await res.text()) || res.statusText;
        // Tente ver se é JSON para extrair a mensagem
        try {
          const json = JSON.parse(text);
          throw new Error(json.message || `${res.status}: ${text}`);
        } catch (e) {
          // Não é JSON válido, retornar texto como está
          throw new Error(`${res.status}: ${text}`);
        }
      } catch (err) {
        // Se falhar ao ler o texto (ex: corpo vazio)
        throw new Error(`${res.status}: ${res.statusText || 'Erro ao processar requisição'}`);
      }
    }
  }
}

// Definir tipo para opções extras
interface ApiRequestOptions {
  responseType?: 'json' | 'blob' | 'text';
  // Adicionar outras opções de fetch se necessário (ex: headers customizados)
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
  options?: ApiRequestOptions // <<< Adicionar argumento de opções
): Promise<any> { // <<< Mudar tipo de retorno para any ou um tipo mais específico
  const fetchOptions: RequestInit = {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  };

  const res = await fetch(url, fetchOptions);
  const responseType = options?.responseType || 'json';

  await throwIfResNotOk(res, responseType);

  // Processar resposta com base nas opções

  if (responseType === 'blob') {
    console.log("apiRequest: Retornando Blob");
    return await res.blob();
  } else if (responseType === 'text') {
    console.log("apiRequest: Retornando Texto");
    return await res.text();
  } else { // Default 'json'
    console.log("apiRequest: Retornando JSON");
    // Lidar com respostas JSON vazias (ex: 204 No Content)
    const text = await res.text();
    try {
        return text ? JSON.parse(text) : null; // Retorna null se corpo vazio
    } catch (e) {
        console.error("Falha ao parsear JSON:", e, "Texto recebido:", text);
        throw new Error("Falha ao processar resposta JSON do servidor.");
    }
  }
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const url = queryKey[0] as string;
    
    const res = await fetch(url, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res, 'json');
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
