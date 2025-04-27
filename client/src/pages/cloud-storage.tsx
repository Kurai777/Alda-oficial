/**
 * Página de Configuração e Monitoramento de Armazenamento em Nuvem
 * 
 * Esta página permite visualizar, configurar e monitorar o armazenamento em nuvem
 * da plataforma, com métricas de uso e opções de migração.
 */

import React, { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { 
  Card, 
  CardContent, 
  CardDescription, 
  CardFooter, 
  CardHeader, 
  CardTitle 
} from '@/components/ui/card';
import { 
  Cloud, 
  CloudOff, 
  Database, 
  HardDrive, 
  Upload,
  DownloadCloud,
  FileType,
  Image,
  FileArchive,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Info,
  BarChart3,
  File
} from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Separator } from '@/components/ui/separator';
import { formatDate, formatBytes } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';

// Interface para métricas de armazenamento
interface StorageMetrics {
  totalSize: number;
  fileCount: number;
  lastUpdate: string;
  byType: {
    [key: string]: {
      size: number;
      count: number;
    }
  };
  byCatalog: {
    id: number;
    name: string;
    size: number;
    fileCount: number;
  }[];
}

// Interface para status de conexão S3
interface S3Status {
  connected: boolean;
  bucket: string;
  region: string;
  message: string;
  lastCheck: string;
}

// Interface para status de migração
interface MigrationStatus {
  inProgress: boolean;
  totalItems: number;
  completedItems: number;
  failedItems: number;
  progress: number;
  currentOperation: string;
  lastMigration: string | null;
}

const CloudStoragePage: React.FC = () => {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState('overview');
  const [selectedCatalogId, setSelectedCatalogId] = useState<number | null>(null);

  // Consulta para obter status do S3
  const { 
    data: s3Status,
    isLoading: isLoadingS3Status,
    error: s3StatusError
  } = useQuery<S3Status>({
    queryKey: ['/api/storage/s3-status'],
    refetchInterval: 300000, // 5 minutos
  });

  // Consulta para obter métricas de armazenamento
  const {
    data: storageMetrics,
    isLoading: isLoadingMetrics,
    error: metricsError
  } = useQuery<StorageMetrics>({
    queryKey: ['/api/storage/metrics'],
    refetchInterval: 600000, // 10 minutos
  });

  // Consulta para status de migração
  const {
    data: migrationStatus,
    isLoading: isLoadingMigration,
    error: migrationError
  } = useQuery<MigrationStatus>({
    queryKey: ['/api/storage/migration-status'],
    refetchInterval: (data) => {
      if (data && 'inProgress' in data && data.inProgress) {
        return 5000; // 5 segundos se em progresso
      }
      return 60000; // 1 minuto se não
    }
  });

  // Consulta para lista de catálogos
  const {
    data: catalogsData,
    isLoading: isLoadingCatalogs,
    error: catalogsError
  } = useQuery({
    queryKey: ['/api/catalogs'],
  });
  
  // Processar os dados de catálogos para garantir que sejam um array
  const catalogs = React.useMemo(() => {
    if (!catalogsData) return [];
    return Array.isArray(catalogsData) ? catalogsData : [];
  }, [catalogsData]);

  // Mutação para iniciar migração completa
  const startMigrationMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/storage/migrate-all');
      return await res.json();
    },
    onSuccess: () => {
      toast({
        title: 'Migração iniciada',
        description: 'Processo de migração para nuvem iniciado com sucesso.',
      });
      // Invalidar consultas para atualizar dados
      queryClient.invalidateQueries({ queryKey: ['/api/storage/migration-status'] });
    },
    onError: (error: Error) => {
      toast({
        title: 'Erro ao iniciar migração',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Mutação para iniciar migração de catálogo específico
  const migrateCatalogMutation = useMutation({
    mutationFn: async (catalogId: number) => {
      const res = await apiRequest('POST', `/api/storage/migrate-catalog/${catalogId}`);
      return await res.json();
    },
    onSuccess: (_data, catalogId) => {
      toast({
        title: 'Migração de catálogo iniciada',
        description: `Migração do catálogo ID ${catalogId} iniciada com sucesso.`,
      });
      // Invalidar consultas para atualizar dados
      queryClient.invalidateQueries({ queryKey: ['/api/storage/migration-status'] });
    },
    onError: (error: Error) => {
      toast({
        title: 'Erro ao iniciar migração de catálogo',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Iniciar migração de todos os catálogos
  const handleStartMigration = () => {
    startMigrationMutation.mutate();
  };

  // Iniciar migração de um catálogo específico
  const handleMigrateCatalog = (catalogId: number) => {
    migrateCatalogMutation.mutate(catalogId);
  };

  // Verificar se há erro em qualquer consulta
  const hasError = s3StatusError || metricsError || migrationError || catalogsError;

  // Carregar indicadores
  const isLoading = isLoadingS3Status || isLoadingMetrics || isLoadingMigration || isLoadingCatalogs;

  // Renderizar indicador de status do S3
  const renderS3StatusIndicator = () => {
    if (isLoadingS3Status) {
      return <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />;
    }

    if (!s3Status) {
      return <AlertCircle className="h-5 w-5 text-destructive" />;
    }

    return s3Status.connected ? (
      <CheckCircle2 className="h-5 w-5 text-success" />
    ) : (
      <CloudOff className="h-5 w-5 text-destructive" />
    );
  };

  return (
    <div className="container py-6 space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Armazenamento em Nuvem</h1>
          <p className="text-muted-foreground">Gerencie e monitore os arquivos na nuvem da aplicação</p>
        </div>
        <div className="flex items-center gap-2">
          <Button 
            onClick={handleStartMigration} 
            disabled={isLoading || (migrationStatus?.inProgress) || !s3Status?.connected || startMigrationMutation.isPending}
          >
            {startMigrationMutation.isPending ? (
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <DownloadCloud className="mr-2 h-4 w-4" />
            )}
            Migrar Todos os Arquivos
          </Button>
        </div>
      </div>

      {hasError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Erro</AlertTitle>
          <AlertDescription>
            Ocorreu um erro ao carregar informações de armazenamento.{' '}
            <Button variant="link" onClick={() => queryClient.invalidateQueries()}>
              Tentar novamente
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {/* Status do S3 */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Status da Nuvem</CardTitle>
            {renderS3StatusIndicator()}
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {isLoadingS3Status ? (
                <div className="h-8 w-32 animate-pulse bg-muted rounded"></div>
              ) : s3Status?.connected ? (
                "Conectado"
              ) : (
                "Desconectado"
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {isLoadingS3Status ? (
                <div className="h-4 w-48 animate-pulse bg-muted rounded mt-1"></div>
              ) : s3Status?.connected ? (
                `Bucket: ${s3Status.bucket} (${s3Status.region})`
              ) : (
                s3Status?.message || "Verifique as credenciais da AWS"
              )}
            </p>
          </CardContent>
        </Card>

        {/* Armazenamento Total */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Armazenamento Total</CardTitle>
            <HardDrive className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {isLoadingMetrics ? (
                <div className="h-8 w-24 animate-pulse bg-muted rounded"></div>
              ) : storageMetrics ? (
                formatBytes(storageMetrics.totalSize)
              ) : (
                "0 B"
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {isLoadingMetrics ? (
                <div className="h-4 w-40 animate-pulse bg-muted rounded mt-1"></div>
              ) : storageMetrics ? (
                `${storageMetrics.fileCount} arquivos no total`
              ) : (
                "Nenhum arquivo encontrado"
              )}
            </p>
          </CardContent>
        </Card>

        {/* Status da Migração */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Status da Migração</CardTitle>
            <Upload className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {isLoadingMigration ? (
                <div className="h-8 w-40 animate-pulse bg-muted rounded"></div>
              ) : migrationStatus?.inProgress ? (
                `${migrationStatus.progress.toFixed(0)}%`
              ) : (
                "Completo"
              )}
            </div>
            {!isLoadingMigration && migrationStatus?.inProgress && (
              <Progress value={migrationStatus.progress} className="h-2 mt-2" />
            )}
            <p className="text-xs text-muted-foreground mt-1">
              {isLoadingMigration ? (
                <div className="h-4 w-48 animate-pulse bg-muted rounded mt-1"></div>
              ) : migrationStatus?.inProgress ? (
                `${migrationStatus.completedItems}/${migrationStatus.totalItems} itens processados`
              ) : migrationStatus?.lastMigration ? (
                `Última migração: ${formatDate(migrationStatus.lastMigration, 'relative')}`
              ) : (
                "Nenhuma migração realizada"
              )}
            </p>
          </CardContent>
        </Card>

        {/* Catálogos */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Catálogos</CardTitle>
            <Database className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {isLoadingCatalogs ? (
                <div className="h-8 w-16 animate-pulse bg-muted rounded"></div>
              ) : catalogs ? (
                Array.isArray(catalogs) ? catalogs.length : "0"
              ) : (
                "0"
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {isLoadingCatalogs ? (
                <div className="h-4 w-40 animate-pulse bg-muted rounded mt-1"></div>
              ) : (
                "Catálogos disponíveis para migração"
              )}
            </p>
          </CardContent>
        </Card>
      </div>

      <Tabs 
        defaultValue="overview" 
        value={activeTab} 
        onValueChange={setActiveTab}
        className="space-y-4"
      >
        <TabsList>
          <TabsTrigger value="overview">Visão Geral</TabsTrigger>
          <TabsTrigger value="catalogs">Catálogos</TabsTrigger>
          <TabsTrigger value="migration">Migração</TabsTrigger>
        </TabsList>
        
        {/* Conteúdo da aba Visão Geral */}
        <TabsContent value="overview" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Distribuição de Armazenamento</CardTitle>
              <CardDescription>Análise do uso de armazenamento por tipo de arquivo</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoadingMetrics ? (
                <div className="space-y-3">
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="flex flex-col gap-2">
                      <div className="h-5 w-32 animate-pulse bg-muted rounded"></div>
                      <div className="h-4 w-full animate-pulse bg-muted rounded"></div>
                    </div>
                  ))}
                </div>
              ) : !storageMetrics || !storageMetrics.byType ? (
                <div className="py-6 text-center">
                  <Info className="mx-auto h-10 w-10 text-muted-foreground" />
                  <h3 className="mt-2 text-lg font-semibold">Sem dados disponíveis</h3>
                  <p className="text-sm text-muted-foreground">
                    Não há informações de armazenamento para exibir
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {Object.keys(storageMetrics.byType).map((fileType) => {
                    const typeData = storageMetrics.byType[fileType];
                    const percentage = (typeData.size / storageMetrics.totalSize) * 100;
                    
                    return (
                      <div key={fileType} className="space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center">
                            {fileType === 'image' && <Image className="mr-2 h-4 w-4" />}
                            {fileType === 'pdf' && <FileType className="mr-2 h-4 w-4" />}
                            {fileType === 'excel' && <FileArchive className="mr-2 h-4 w-4" />}
                            {fileType === 'other' && <div className="mr-2 h-4 w-4"><File className="h-4 w-4" /></div>}
                            <span className="text-sm font-medium">
                              {fileType === 'image' ? 'Imagens' : 
                                fileType === 'pdf' ? 'PDFs' : 
                                fileType === 'excel' ? 'Planilhas' : 
                                'Outros'}
                            </span>
                          </div>
                          <span className="text-sm text-muted-foreground">
                            {formatBytes(typeData.size)} ({typeData.count} arquivos)
                          </span>
                        </div>
                        <Progress value={percentage} className="h-2" />
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Informações de Armazenamento</CardTitle>
              <CardDescription>Dados sobre o estado atual do armazenamento em nuvem</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-4">
                  <div>
                    <h4 className="text-sm font-medium mb-2">Status do Amazon S3</h4>
                    {isLoadingS3Status ? (
                      <div className="h-24 w-full animate-pulse bg-muted rounded"></div>
                    ) : !s3Status ? (
                      <Alert>
                        <AlertCircle className="h-4 w-4" />
                        <AlertTitle>Indisponível</AlertTitle>
                        <AlertDescription>
                          Não foi possível obter o status do Amazon S3
                        </AlertDescription>
                      </Alert>
                    ) : (
                      <div className="space-y-2">
                        <div className="flex justify-between">
                          <span className="text-sm">Status:</span>
                          <span className={`text-sm font-medium ${s3Status.connected ? 'text-success' : 'text-destructive'}`}>
                            {s3Status.connected ? 'Conectado' : 'Desconectado'}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm">Bucket:</span>
                          <span className="text-sm font-medium">{s3Status.bucket}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm">Região:</span>
                          <span className="text-sm font-medium">{s3Status.region}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm">Última verificação:</span>
                          <span className="text-sm">{formatDate(s3Status.lastCheck, 'relative')}</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <h4 className="text-sm font-medium mb-2">Métricas de Armazenamento</h4>
                    {isLoadingMetrics ? (
                      <div className="h-24 w-full animate-pulse bg-muted rounded"></div>
                    ) : !storageMetrics ? (
                      <Alert>
                        <AlertCircle className="h-4 w-4" />
                        <AlertTitle>Indisponível</AlertTitle>
                        <AlertDescription>
                          Não foi possível obter métricas de armazenamento
                        </AlertDescription>
                      </Alert>
                    ) : (
                      <div className="space-y-2">
                        <div className="flex justify-between">
                          <span className="text-sm">Armazenamento total:</span>
                          <span className="text-sm font-medium">{formatBytes(storageMetrics.totalSize)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm">Arquivos:</span>
                          <span className="text-sm font-medium">{storageMetrics.fileCount}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm">Catálogos:</span>
                          <span className="text-sm font-medium">
                            {storageMetrics.byCatalog?.length || 0}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm">Última atualização:</span>
                          <span className="text-sm">{formatDate(storageMetrics.lastUpdate, 'relative')}</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        
        {/* Conteúdo da aba Catálogos */}
        <TabsContent value="catalogs" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Catálogos Disponíveis</CardTitle>
              <CardDescription>Migre catálogos específicos para a nuvem</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoadingCatalogs ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nome</TableHead>
                      <TableHead>Arquivos</TableHead>
                      <TableHead>Tamanho</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[1, 2, 3].map((i) => (
                      <TableRow key={i}>
                        <TableCell>
                          <div className="h-5 w-40 animate-pulse bg-muted rounded"></div>
                        </TableCell>
                        <TableCell>
                          <div className="h-5 w-16 animate-pulse bg-muted rounded"></div>
                        </TableCell>
                        <TableCell>
                          <div className="h-5 w-20 animate-pulse bg-muted rounded"></div>
                        </TableCell>
                        <TableCell>
                          <div className="h-5 w-24 animate-pulse bg-muted rounded"></div>
                        </TableCell>
                        <TableCell>
                          <div className="h-9 w-24 animate-pulse bg-muted rounded"></div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : !catalogs || !Array.isArray(catalogs) || catalogs.length === 0 ? (
                <div className="py-8 text-center">
                  <Database className="mx-auto h-10 w-10 text-muted-foreground" />
                  <h3 className="mt-2 text-lg font-semibold">Nenhum catálogo encontrado</h3>
                  <p className="text-sm text-muted-foreground">
                    Não há catálogos disponíveis para migração
                  </p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nome</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Arquivo</TableHead>
                      <TableHead>Data</TableHead>
                      <TableHead className="text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {catalogs.map((catalog) => (
                      <TableRow key={catalog.id}>
                        <TableCell className="font-medium">{catalog.name || `Catálogo #${catalog.id}`}</TableCell>
                        <TableCell>
                          <span className={`px-2 py-1 rounded-full text-xs ${
                            catalog.processedStatus === 'completed' 
                              ? 'bg-success/20 text-success' 
                              : catalog.processedStatus === 'processing'
                              ? 'bg-warning/20 text-warning'
                              : 'bg-muted text-muted-foreground'
                          }`}>
                            {catalog.processedStatus === 'completed' 
                              ? 'Concluído' 
                              : catalog.processedStatus === 'processing'
                              ? 'Processando'
                              : 'Pendente'}
                          </span>
                        </TableCell>
                        <TableCell>{catalog.fileName}</TableCell>
                        <TableCell>{formatDate(catalog.createdAt, 'short')}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleMigrateCatalog(catalog.id)}
                            disabled={migrationStatus?.inProgress || migrateCatalogMutation.isPending}
                          >
                            {migrateCatalogMutation.isPending && selectedCatalogId === catalog.id ? (
                              <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <Cloud className="mr-2 h-4 w-4" />
                            )}
                            Migrar
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
            {!isLoadingCatalogs && catalogs && Array.isArray(catalogs) && catalogs.length > 0 && (
              <CardFooter className="flex justify-between">
                <p className="text-sm text-muted-foreground">
                  Total de {catalogs.length} catálogo(s)
                </p>
                <Button 
                  variant="default"
                  onClick={handleStartMigration}
                  disabled={migrationStatus?.inProgress || startMigrationMutation.isPending}
                >
                  {startMigrationMutation.isPending ? (
                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <DownloadCloud className="mr-2 h-4 w-4" />
                  )}
                  Migrar Todos
                </Button>
              </CardFooter>
            )}
          </Card>
        </TabsContent>
        
        {/* Conteúdo da aba Migração */}
        <TabsContent value="migration" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Status da Migração</CardTitle>
              <CardDescription>Acompanhe o progresso da migração para a nuvem</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoadingMigration ? (
                <div className="space-y-4">
                  <div className="h-6 w-48 animate-pulse bg-muted rounded"></div>
                  <div className="h-4 w-full animate-pulse bg-muted rounded"></div>
                  <div className="space-y-2">
                    {[1, 2, 3, 4].map((i) => (
                      <div key={i} className="flex justify-between">
                        <div className="h-5 w-32 animate-pulse bg-muted rounded"></div>
                        <div className="h-5 w-24 animate-pulse bg-muted rounded"></div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : !migrationStatus ? (
                <div className="py-6 text-center">
                  <Info className="mx-auto h-10 w-10 text-muted-foreground" />
                  <h3 className="mt-2 text-lg font-semibold">Sem dados de migração</h3>
                  <p className="text-sm text-muted-foreground">
                    Não há informações sobre migração disponíveis
                  </p>
                </div>
              ) : migrationStatus.inProgress ? (
                <div className="space-y-6">
                  <div>
                    <div className="flex justify-between mb-2">
                      <h3 className="text-lg font-semibold">Migração em Andamento</h3>
                      <span className="text-sm font-medium">{migrationStatus.progress.toFixed(0)}%</span>
                    </div>
                    <Progress value={migrationStatus.progress} className="h-2" />
                    <p className="text-sm text-muted-foreground mt-2">
                      {migrationStatus.currentOperation}
                    </p>
                  </div>
                  
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <Card>
                        <CardContent className="pt-6">
                          <div className="text-2xl font-bold text-center">{migrationStatus.completedItems}</div>
                          <p className="text-xs text-muted-foreground text-center">Itens concluídos</p>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="pt-6">
                          <div className="text-2xl font-bold text-center">{migrationStatus.failedItems}</div>
                          <p className="text-xs text-muted-foreground text-center">Itens com falha</p>
                        </CardContent>
                      </Card>
                    </div>
                    
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span className="text-sm">Total de itens:</span>
                        <span className="text-sm font-medium">{migrationStatus.totalItems}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm">Progresso:</span>
                        <span className="text-sm font-medium">
                          {migrationStatus.completedItems}/{migrationStatus.totalItems} ({migrationStatus.progress.toFixed(0)}%)
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm">Taxa de sucesso:</span>
                        <span className="text-sm font-medium">
                          {migrationStatus.completedItems > 0 
                            ? ((migrationStatus.completedItems - migrationStatus.failedItems) / migrationStatus.completedItems * 100).toFixed(0) 
                            : 0}%
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-6">
                  {migrationStatus.lastMigration ? (
                    <>
                      <Alert className="bg-success/10 text-success">
                        <CheckCircle2 className="h-4 w-4" />
                        <AlertTitle>Migração Concluída</AlertTitle>
                        <AlertDescription>
                          A última migração foi concluída em {formatDate(migrationStatus.lastMigration, 'long')}
                        </AlertDescription>
                      </Alert>
                      
                      <div className="space-y-2">
                        <div className="flex justify-between">
                          <span className="text-sm">Total de itens:</span>
                          <span className="text-sm font-medium">{migrationStatus.totalItems}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm">Itens concluídos:</span>
                          <span className="text-sm font-medium">{migrationStatus.completedItems}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm">Itens com falha:</span>
                          <span className="text-sm font-medium">{migrationStatus.failedItems}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm">Taxa de sucesso:</span>
                          <span className="text-sm font-medium">
                            {migrationStatus.completedItems > 0 
                              ? ((migrationStatus.completedItems - migrationStatus.failedItems) / migrationStatus.completedItems * 100).toFixed(0) 
                              : 0}%
                          </span>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="py-6 text-center">
                      <CloudOff className="mx-auto h-10 w-10 text-muted-foreground" />
                      <h3 className="mt-2 text-lg font-semibold">Sem migrações recentes</h3>
                      <p className="text-sm text-muted-foreground">
                        Nenhuma migração foi iniciada recentemente
                      </p>
                      <Button 
                        className="mt-4"
                        onClick={handleStartMigration}
                        disabled={!s3Status?.connected || startMigrationMutation.isPending}
                      >
                        {startMigrationMutation.isPending ? (
                          <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <DownloadCloud className="mr-2 h-4 w-4" />
                        )}
                        Iniciar Migração
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default CloudStoragePage;