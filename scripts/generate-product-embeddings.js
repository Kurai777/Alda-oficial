"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
var openai_1 = require("openai");
var db_1 = require("../server/db"); // Path correto
var schema_1 = require("../shared/schema"); // Path correto
var drizzle_orm_1 = require("drizzle-orm");
console.log("[SCRIPT START] Iniciando generate-product-embeddings.ts...");
// Configurar cliente OpenAI
var openai = process.env.OPENAI_API_KEY ? new openai_1.default({ apiKey: process.env.OPENAI_API_KEY }) : null;
var EMBEDDING_MODEL = 'text-embedding-3-small';
function generateEmbeddings() {
    return __awaiter(this, void 0, void 0, function () {
        var productsToProcess, _i, productsToProcess_1, product, inputText, embeddingResponse, embeddingVector, error_1, dbError_1;
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    console.log("[SCRIPT LOGIC] Dentro de generateEmbeddings(). Verificando OpenAI key...");
                    if (!openai) {
                        console.error('Chave da API OpenAI não configurada. Abortando.');
                        process.exit(1);
                    }
                    console.log("[SCRIPT LOGIC] Chave OpenAI OK. Conectando ao DB...");
                    console.log('Buscando produtos sem embedding...');
                    _b.label = 1;
                case 1:
                    _b.trys.push([1, 11, , 12]);
                    return [4 /*yield*/, db_1.db.select({
                            id: schema_1.products.id,
                            name: schema_1.products.name,
                            description: schema_1.products.description,
                            category: schema_1.products.category
                        })
                            .from(schema_1.products)
                            .where((0, drizzle_orm_1.isNull)(schema_1.products.embedding))];
                case 2:
                    productsToProcess = _b.sent();
                    console.log("[SCRIPT LOGIC] Consulta ao DB conclu\u00EDda. Encontrados ".concat(productsToProcess.length, " produtos."));
                    if (productsToProcess.length === 0) {
                        console.log('Nenhum produto novo para gerar embeddings.');
                        return [2 /*return*/];
                    }
                    console.log("Encontrados ".concat(productsToProcess.length, " produtos para processar. Iniciando loop..."));
                    _i = 0, productsToProcess_1 = productsToProcess;
                    _b.label = 3;
                case 3:
                    if (!(_i < productsToProcess_1.length)) return [3 /*break*/, 10];
                    product = productsToProcess_1[_i];
                    console.log("Processando produto ID: ".concat(product.id, " - ").concat(product.name));
                    inputText = "Nome: ".concat(product.name || '', "\nCategoria: ").concat(product.category || '', "\nDescri\u00E7\u00E3o: ").concat(product.description || '');
                    if (!inputText.trim() || inputText.trim() === "Nome: \nCategoria: \nDescrição:") {
                        console.warn("   Produto ID: ".concat(product.id, " tem texto vazio. Pulando."));
                        return [3 /*break*/, 9];
                    }
                    _b.label = 4;
                case 4:
                    _b.trys.push([4, 8, , 9]);
                    console.log("   Chamando OpenAI API para ID: ".concat(product.id, "..."));
                    // 2. Gerar embedding com OpenAI
                    console.log("   Gerando embedding para: \"".concat(inputText.substring(0, 100), "...\""));
                    return [4 /*yield*/, openai.embeddings.create({
                            model: EMBEDDING_MODEL,
                            input: inputText,
                        })];
                case 5:
                    embeddingResponse = _b.sent();
                    embeddingVector = (_a = embeddingResponse.data[0]) === null || _a === void 0 ? void 0 : _a.embedding;
                    console.log("   OpenAI respondeu para ID: ".concat(product.id, ". Vetor ").concat(embeddingVector ? 'OK' : 'NULO', "."));
                    if (!embeddingVector) {
                        console.error("   Falha ao gerar embedding para produto ID: ".concat(product.id, ". Resposta da API n\u00E3o continha vetor."));
                        return [3 /*break*/, 9]; // Pular para o próximo produto
                    }
                    // 3. Salvar vetor no banco de dados
                    console.log("   Salvando embedding (".concat(embeddingVector.length, " dimens\u00F5es) no banco de dados..."));
                    return [4 /*yield*/, db_1.db.update(schema_1.products)
                            .set({ embedding: embeddingVector })
                            .where((0, drizzle_orm_1.eq)(schema_1.products.id, product.id))];
                case 6:
                    _b.sent();
                    console.log("   Embedding salvo com sucesso para produto ID: ".concat(product.id, "."));
                    // Adicionar um pequeno delay para evitar rate limiting da API OpenAI
                    return [4 /*yield*/, new Promise(function (resolve) { return setTimeout(resolve, 200); })];
                case 7:
                    // Adicionar um pequeno delay para evitar rate limiting da API OpenAI
                    _b.sent(); // 200ms delay
                    return [3 /*break*/, 9];
                case 8:
                    error_1 = _b.sent();
                    console.error("   Erro ao processar produto ID: ".concat(product.id, ":"), error_1.message || error_1);
                    return [3 /*break*/, 9];
                case 9:
                    _i++;
                    return [3 /*break*/, 3];
                case 10:
                    console.log('Processamento de embeddings concluído.');
                    return [3 /*break*/, 12];
                case 11:
                    dbError_1 = _b.sent();
                    console.error('Erro ao buscar produtos do banco de dados:', dbError_1);
                    process.exit(1);
                    return [3 /*break*/, 12];
                case 12: return [2 /*return*/];
            }
        });
    });
}
console.log("[SCRIPT START] Chamando generateEmbeddings()...");
generateEmbeddings().then(function () {
    console.log("[SCRIPT END] generateEmbeddings() concluído com sucesso.");
    process.exit(0);
}).catch(function (err) {
    console.error("[SCRIPT END] Erro inesperado durante a geração de embeddings:", err);
    process.exit(1);
});
