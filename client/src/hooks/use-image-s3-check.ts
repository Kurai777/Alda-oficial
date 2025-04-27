/**
 * Hook para verificar e garantir que as imagens estejam disponíveis no S3
 * 
 * Este hook verifica se uma imagem está disponível no S3 e, se necessário,
 * inicia automaticamente um processo de migração para garantir disponibilidade.
 */

import { useState, useEffect } from 'react';
import { apiRequest } from '@/lib/queryClient';

interface ImageS3Status {
  exists: boolean;
  s3Available: boolean;
  s3Exists: boolean;
  localExists: boolean;
  storageType: 'none' | 's3' | 'local';
  accessUrl: string | null;
}

interface ImageS3CheckResult {
  loading: boolean;
  imageUrl: string | null;
  isS3Image: boolean;
  status: ImageS3Status | null;
  error: string | null;
  checkStatus: () => Promise<ImageS3Status>;
  migrateToS3: () => Promise<boolean>;
}

/**
 * Hook para verificar status de imagem no S3
 * 
 * @param userId ID do usuário dono da imagem
 * @param catalogId ID do catálogo ao qual a imagem pertence
 * @param filename Nome do arquivo da imagem
 * @param options Opções adicionais
 */
export function useImageS3Check(
  userId: number | string,
  catalogId: number | string,
  filename: string,
  options: {
    autoMigrate?: boolean;
    autoCheck?: boolean;
    delay?: number;
  } = {}
): ImageS3CheckResult {
  const { 
    autoMigrate = false,
    autoCheck = true,
    delay = 0
  } = options;
  
  const [loading, setLoading] = useState<boolean>(true);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [isS3Image, setIsS3Image] = useState<boolean>(false);
  const [status, setStatus] = useState<ImageS3Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  /**
   * Verificar status da imagem
   */
  const checkStatus = async (): Promise<ImageS3Status> => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await apiRequest(
        'GET',
        `/api/storage/image-status/${userId}/${catalogId}/${filename}`
      );
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || 'Erro ao verificar status da imagem');
      }
      
      const statusData: ImageS3Status = await response.json();
      setStatus(statusData);
      
      if (statusData.exists) {
        setImageUrl(statusData.accessUrl);
        setIsS3Image(statusData.storageType === 's3');
      }
      
      return statusData;
    } catch (error: any) {
      console.error('Erro ao verificar status da imagem:', error);
      setError(error.message || 'Erro desconhecido ao verificar imagem');
      throw error;
    } finally {
      setLoading(false);
    }
  };
  
  /**
   * Migrar imagem para S3
   */
  const migrateToS3 = async (): Promise<boolean> => {
    try {
      setLoading(true);
      setError(null);
      
      // Primeiro verifica se a migração é necessária
      const currentStatus = await checkStatus();
      
      // Se já está no S3, não precisa migrar
      if (currentStatus.s3Exists) {
        return true;
      }
      
      // Migrar todas as imagens do catálogo para S3
      const migrateResponse = await apiRequest(
        'POST',
        `/api/storage/migrate-images/${userId}/${catalogId}`
      );
      
      if (!migrateResponse.ok) {
        const errorText = await migrateResponse.text();
        throw new Error(errorText || 'Erro ao migrar imagem para S3');
      }
      
      const migrationResult = await migrateResponse.json();
      
      if (!migrationResult.success) {
        throw new Error(migrationResult.message || 'Falha na migração para S3');
      }
      
      // Atualizar status após migração
      await checkStatus();
      
      return true;
    } catch (error: any) {
      console.error('Erro ao migrar imagem para S3:', error);
      setError(error.message || 'Erro desconhecido ao migrar imagem');
      return false;
    } finally {
      setLoading(false);
    }
  };
  
  // Verificar automaticamente no carregamento
  useEffect(() => {
    if (autoCheck) {
      const checkTimer = setTimeout(() => {
        checkStatus().then(status => {
          // Migrar automaticamente se configurado
          if (autoMigrate && status.s3Available && !status.s3Exists && status.localExists) {
            migrateToS3().catch(console.error);
          }
        }).catch(console.error);
      }, delay);
      
      return () => clearTimeout(checkTimer);
    }
  }, [autoCheck, autoMigrate, delay]);
  
  return {
    loading,
    imageUrl,
    isS3Image,
    status,
    error,
    checkStatus,
    migrateToS3
  };
}

export default useImageS3Check;