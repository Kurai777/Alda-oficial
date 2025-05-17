# Documentação do Schema do Banco de Dados (Inspeção Visual)

Este documento descreve a estrutura das tabelas do banco de dados "neondb" com base na inspeção visual das imagens fornecidas e no arquivo `shared/schema.ts` existente.

## Legenda (Tipos Inferidos)
*   **Serial, PK**: Chave Primária Autoincrementável
*   **Text**: Tipo texto (varchar, text, etc.)
*   **Integer**: Tipo numérico inteiro
*   **JSON**: Tipo JSON ou JSONB
*   **Timestamp**: Tipo data/hora
*   **Boolean**: Tipo booleano (true/false)
*   **Real**: Tipo numérico de ponto flutuante
*   **Vector**: Tipo para embeddings vetoriais
*   **FK para `tabela.coluna`**: Chave Estrangeira referenciando outra tabela
*   **Nullable**: Indica que a coluna pode conter valores nulos

---

## 1. Tabela: `ai_design_chat_messages`

| Coluna           | Tipo Inferido                             | Notas                                         |
|------------------|-------------------------------------------|-----------------------------------------------|
| `id`             | Serial, PK                                |                                               |
| `project_id`     | Integer, FK para `design_projects.id`     | Referencia `design_project` nas imagens       |
| `role`           | Text                                      | Ex: "system", "user", "assistant"           |
| `content`        | Text                                      |                                               |
| `attachment_url` | Text, Nullable                            |                                               |
| `created_at`     | Timestamp                                 |                                               |

---

## 2. Tabela: `ai_design_projects`

| Coluna                     | Tipo Inferido                            | Notas                                      |
|----------------------------|------------------------------------------|--------------------------------------------|
| `id`                       | Serial, PK                               |                                            |
| `user_id`                  | Integer, FK para `users.id`              |                                            |
| `title`                    | Text                                     |                                            |
| `status`                   | Text                                     | Ex: "pending"                              |
| `floor_plan_image_url`     | Text, Nullable                           |                                            |
| `render_image_url`         | Text, Nullable                           |                                            |
| `generated_floor_plan_url` | Text, Nullable                           |                                            |
| `generated_render_url`     | Text, Nullable                           |                                            |
| `quote_id`                 | Integer, FK para `quotes.id`, Nullable   | Referencia `quote` nas imagens             |
| `moodboard_id`             | Integer, FK para `moodboards.id`, Nullable | Referencia `moodboard` nas imagens         |
| `created_at`               | Timestamp                                |                                            |

---

## 3. Tabela: `catalogs`

| Coluna                 | Tipo Inferido                 | Notas                                  |
|------------------------|-------------------------------|----------------------------------------|
| `id`                   | Serial, PK                    |                                        |
| `user_id`              | Integer, FK para `users.id`   |                                        |
| `file_name`            | Text                          |                                        |
| `file_url`             | Text                          |                                        |
| `processed_status`     | Text                          | Ex: "completed", "pending"             |
| `created_at`           | Timestamp                     |                                        |
| `firestore_catalog_id` | Text, Nullable                |                                        |
| `firebase_user_id`     | Text, Nullable                |                                        |

---

## 4. Tabela: `design_project_items`

| Coluna                          | Tipo Inferido                            | Notas                                                                  |
|---------------------------------|------------------------------------------|------------------------------------------------------------------------|
| `id`                            | Serial, PK                               |                                                                        |
| `design_project_id`             | Integer, FK para `design_projects.id`    |                                                                        |
| `detected_object_name`          | Text, Nullable                           | *Não existe no BD ainda, adicionado ao schema.ts, será criado no push* |
| `detected_object_description`   | Text, Nullable                           |                                                                        |
| `detected_object_bounding_box`  | JSON, Nullable                           |                                                                        |
| `suggested_product_id_1`        | Integer, FK para `products.id`, Nullable |                                                                        |
| `match_score_1`                 | Real, Nullable                           |                                                                        |
| `suggested_product_id_2`        | Integer, FK para `products.id`, Nullable |                                                                        |
| `match_score_2`                 | Real, Nullable                           |                                                                        |
| `suggested_product_id_3`        | Integer, FK para `products.id`, Nullable |                                                                        |
| `match_score_3`                 | Real, Nullable                           |                                                                        |
| `selected_product_id`           | Integer, FK para `products.id`, Nullable |                                                                        |
| `user_feedback`                 | Text, Nullable                           |                                                                        |
| `created_at`                    | Timestamp                                |                                                                        |
| `updated_at`                    | Timestamp                                |                                                                        |

---

## 5. Tabela: `design_projects`

| Coluna                        | Tipo Inferido                 | Notas                                                          |
|-------------------------------|-------------------------------|----------------------------------------------------------------|
| `id`                          | Serial, PK                    |                                                                |
| `user_id`                     | Integer, FK para `users.id`   |                                                                |
| `name`                        | Text                          |                                                                |
| `status`                      | Text                          | Ex: "new"                                                      |
| `client_render_image_url`     | Text, Nullable                |                                                                |
| `client_floor_plan_image_url` | Text, Nullable                |                                                                |
| `created_at`                  | Timestamp                     |                                                                |
| `updated_at`                  | Timestamp                     |                                                                |
|                               |                               | *Relações com `ai_design_chat_messages`, `design_project_items`* |

---

## 6. Tabela: `floor_plan_areas` (Existe no BD)

| Coluna                  | Tipo Inferido                            | Notas                                                    |
|-------------------------|------------------------------------------|----------------------------------------------------------|
| `id`                    | Serial, PK                               |                                                          |
| `floor_plan_id`         | Integer, FK para `floor_plans.id`        |                                                          |
| `user_id`               | Integer, FK para `users.id`              |                                                          |
| `area_name`             | Text                                     |                                                          |
| `coordinates`           | JSON                                     | Provavelmente para bounding boxes ou polígonos           |
| `desired_product_type`  | Text, Nullable                           |                                                          |
| `suggested_product_id`  | Integer, FK para `products.id`, Nullable |                                                          |
| `notes`                 | Text, Nullable                           |                                                          |
| `created_at`            | Timestamp                                |                                                          |
| `updated_at`            | Timestamp                                |                                                          |
|                         |                                          | *Relações com `floor_plan`, `user`, `product`*             |

---

## 7. Tabela: `floor_plans` (Existe no BD)

| Coluna                  | Tipo Inferido                               | Notas                                                      |
|-------------------------|---------------------------------------------|------------------------------------------------------------|
| `id`                    | Serial, PK                                  |                                                            |
| `user_id`               | Integer, FK para `users.id`                 |                                                            |
| `ai_design_project_id`  | Integer, FK para `ai_design_projects.id`  | Liga-se à tabela `ai_design_projects`                      |
| `name`                  | Text                                        |                                                            |
| `original_image_url`    | Text                                        |                                                            |
| `processed_image_url`   | Text, Nullable                              |                                                            |
| `ia_prompt`             | Text, Nullable                              |                                                            |
| `ia_status`             | Text                                        |                                                            |
| `processing_errors`     | Text, Nullable                              | Provavelmente JSON ou array de strings                     |
| `created_at`            | Timestamp                                   |                                                            |
| `updated_at`            | Timestamp                                   |                                                            |
|                         |                                             | *Relações com `floor_plan_areas`, `user`, `ai_design_project`* |

---

## 8. Tabela: `moodboards` (Campos a sincronizar!)

| Coluna                | Tipo Inferido                            | Notas - Existe no BD!                                     |
|-----------------------|------------------------------------------|-----------------------------------------------------------|
| `id`                  | Serial, PK                               |                                                           |
| `user_id`             | Integer, FK para `users.id`              |                                                           |
| `quote_id`            | Integer, FK para `quotes.id`, Nullable   |                                                           |
| `project_name`        | Text                                     |                                                           |
| `client_name`         | Text, Nullable                           |                                                           |
| `architect_name`      | Text, Nullable                           |                                                           |
| `file_url`            | Text, Nullable                           |                                                           |
| `product_ids`         | JSON (array de numbers)                  |                                                           |
| `created_at`          | Timestamp                                |                                                           |
| `description`         | Text, Nullable                           | **Existe no BD!** Adicionar ao `shared/schema.ts`         |
| `style`               | Text, Nullable                           | **Existe no BD!** Adicionar ao `shared/schema.ts`         |
| `color_palette`       | JSON, Nullable (array de strings?)       | **Existe no BD!** Adicionar ao `shared/schema.ts`         |
| `generated_image_url` | Text, Nullable                           | **Existe no BD!** Adicionar ao `shared/schema.ts`         |
| `ia_prompt`           | Text, Nullable                           | **Existe no BD!** Adicionar ao `shared/schema.ts`         |
| `status`              | Text, Nullable                           | **Existe no BD!** Adicionar ao `shared/schema.ts`         |
| `updated_at`          | Timestamp                                | **Existe no BD!** Adicionar ao `shared/schema.ts`         |
|                       |                                          | *Referenciada por `ai_design_projects`*                   |

---

## 9. Tabela: `products`

| Coluna             | Tipo Inferido                            | Notas                                                                   |
|--------------------|------------------------------------------|-------------------------------------------------------------------------|
| `id`               | Serial, PK                               |                                                                         |
| `user_id`          | Integer, FK para `users.id`              |                                                                         |
| `name`             | Text                                     |                                                                         |
| `code`             | Text                                     |                                                                         |
| `description`      | Text, Nullable                           |                                                                         |
| `price`            | Integer                                  | Em centavos                                                             |
| `image_url`        | Text, Nullable                           |                                                                         |
| `colors`           | JSON (array de strings)                  |                                                                         |
| `materials`        | JSON (array de strings)                  |                                                                         |
| `sizes`            | JSON (array de {width,height,depth,label})|                                                                         |
| `created_at`       | Timestamp                                |                                                                         |
| `category`         | Text, Nullable                           |                                                                         |
| `manufacturer`     | Text, Nullable                           |                                                                         |
| `location`         | Text, Nullable                           |                                                                         |
| `stock`            | Integer, Nullable                        |                                                                         |
| `excel_row_number` | Integer, Nullable                        |                                                                         |
| `embedding`        | Vector                                   | **Dimensão 512 no BD**. Ajustar no `shared/schema.ts` (está 768 lá). |
| `search_tsv`       | Tsvector                                 | **Nova coluna para Busca Full-Text**                                      |
| `firestore_id`     | Text, Nullable                           |                                                                         |
| `firebase_user_id` | Text, Nullable                           |                                                                         |
| `is_edited`        | Boolean                                  |                                                                         |
| `catalog_id`       | Integer, FK para `catalogs.id`, Nullable |                                                                         |
|                    |                                          | *Referenciada por `design_project_items`, `floor_plan_areas`*           |

---

## 10. Tabela: `quotes`

| Coluna          | Tipo Inferido                          | Notas                                        |
|-----------------|----------------------------------------|----------------------------------------------|
| `id`            | Serial, PK                             |                                              |
| `user_id`       | Integer, FK para `users.id`            |                                              |
| `client_name`   | Text                                   |                                              |
| `client_email`  | Text, Nullable                         |                                              |
| `client_phone`  | Text, Nullable                         |                                              |
| `architect_name`| Text, Nullable                         |                                              |
| `notes`         | Text, Nullable                         |                                              |
| `items`         | JSON (array de objetos produto)        |                                              |
| `total_price`   | Integer                                | Em centavos                                  |
| `file_url`      | Text, Nullable                         |                                              |
| `created_at`    | Timestamp                              |                                              |
|                 |                                        | *Referenciada por `ai_design_projects`*      |

---

## 11. Tabela: `session`

| Coluna   | Tipo Inferido   | Notas |
|----------|-----------------|-------|
| `sid`    | Varchar, PK     |       |
| `sess`   | JSON            |       |
| `expire` | Timestamp       |       |

---

## 12. Tabela: `users`

| Coluna                       | Tipo Inferido     | Notas                       |
|------------------------------|-------------------|-----------------------------|
| `id`                         | Serial, PK        |                             |
| `email`                      | Text, Unique      |                             |
| `password`                   | Text              | Provavelmente hash          |
| `company_name`               | Text              |                             |
| `name`                       | Text, Nullable    |                             |
| `company_logo_url`           | Text, Nullable    |                             |
| `updated_at`                 | Timestamp         |                             |
| `company_address`            | Text, Nullable    |                             |
| `company_phone`              | Text, Nullable    |                             |
| `company_cnpj`               | Text, Nullable    |                             |
| `quote_payment_terms`        | Text, Nullable    |                             |
| `quote_validity_days`        | Integer, Nullable |                             |
| `cash_discount_percentage`   | Integer, Nullable |                             |
| `created_at`                 | Timestamp         |                             |
|                              |                   | *Referenciada por muitas tabelas* |

--- 