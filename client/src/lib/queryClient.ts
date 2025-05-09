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
  options?: ApiRequestOptions
): Promise<any> {
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
    console.log("apiRequest: Tentando retornar JSON diretamente");
    try {
      // Verificar se o status é 204 (No Content) - não tem corpo
      if (res.status === 204) {
        console.log("apiRequest: Resposta 204 (No Content), retornando null.");
        return null; 
      }
      // Para outros status OK (200-299), tentar parsear como JSON diretamente
      return await res.json();
    } catch (e) {
      // Se falhar ao parsear JSON (mesmo com status OK, o que seria estranho)
      console.error("Falha ao parsear JSON mesmo com resposta OK:", e);
      // Ler como texto para log, mas o corpo já foi consumido por res.json()
      // então precisamos de um fallback ou apenas lançar o erro.
      // const fallbackText = await res.text().catch(() => '[corpo já consumido]'); 
      // console.error("Texto (pode já ter sido consumido):", fallbackText);
      throw new Error("Falha ao processar resposta JSON do servidor, mesmo com status OK.");
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
