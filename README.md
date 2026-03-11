# E-Commerce Multi-Agent Assistant

E-commerce ассистент в формате монорепозитория: пользователь работает в Streamlit UI, backend на FastAPI запускает граф агентов в LangGraph, агенты обращаются к RAG и операционным БД, а результат приходит в интерфейс потоково через SSE.

[![Live Demo](https://img.shields.io/badge/%F0%9F%9A%80%20Live%20Demo-Try%20it%20now-brightgreen?style=for-the-badge)](http://luckydiss-rag-agents.duckdns.org:8501/)

---

![Python](https://img.shields.io/badge/Python-3.11-3776AB?style=flat-square&logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-009688?style=flat-square&logo=fastapi&logoColor=white)
![Streamlit](https://img.shields.io/badge/Streamlit-FF4B4B?style=flat-square&logo=streamlit&logoColor=white)
![LangGraph](https://img.shields.io/badge/LangGraph-LangChain-1C3C3C?style=flat-square&logo=chainlink&logoColor=white)
![Qdrant](https://img.shields.io/badge/Qdrant-Vector%20DB-DC244C?style=flat-square&logo=databricks&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=flat-square&logo=postgresql&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?style=flat-square&logo=docker&logoColor=white)
![LangSmith](https://img.shields.io/badge/LangSmith-Tracing-FF6B35?style=flat-square&logo=langchain&logoColor=white)

---

## Модуль данных

В основе лежат данные Amazon Reviews 2023 (категория Electronics): карточки товаров и отзывы. Перед использованием данные были очищены и отфильтрованы: оставлены валидные товарные карточки, релевантные категории и товары с достаточным количеством отзывов. Для стабильной разработки использовался рабочий сэмпл на 1000 товаров. Подготовленные артефакты были приведены к удобному формату для загрузки в векторное хранилище.

## RAG модуль

RAG отвечает за поиск релевантного товарного и review-контекста для ответов ассистента. В качестве векторной базы используется Qdrant, в системе задействованы коллекции:

- `Amazon-items-collection-01-hybrid-search`
- `Amazon-items-collection-01-reviews`

Поиск построен как hybrid retrieval: dense embeddings + BM25 с fusion. На выходе модуль формирует контекст для генерации ответа и список используемых reference-товаров.

## Агентный модуль

Оркестрация собрана на `StateGraph`.
Точка входа графа: `START -> coordinator_agent`.
Coordinator выбирает следующего исполнителя, специализированные агенты работают в цикле `agent -> tool_node -> agent`, а состояние диалога сохраняется через `PostgresSaver` и `thread_id`.

В системе четыре агента:

- `coordinator_agent`  
  Отвечает за общий план, делегирование и завершение сценария. Прямых инструментов не вызывает.

- `product_qa_agent`  
  Ведет товарный диалог: характеристики, сравнения, отзывы, подбор. Использует инструменты:
  - `get_formatted_items_context(query, top_k)`
  - `get_formatted_reviews_context(query, item_list, top_k)`

- `shopping_cart_agent`  
  Управляет корзиной пользователя, где `thread_id` выступает как `user_id` и `cart_id`. Использует инструменты:
  - `add_to_shopping_cart(items, user_id, cart_id)`
  - `remove_from_cart(product_id, user_id, cart_id)`
  - `get_shopping_cart(user_id, cart_id)`

- `warehouse_manager_agent`  
  Работает со складской доступностью и резервами. Использует инструменты:
  - `check_warehouse_availability(items)`
  - `reserve_warehouse_items(reservations)`

## Backend (FastAPI)

Backend предоставляет два публичных endpoint:

- `POST /agent` - запускает workflow и возвращает `text/event-stream`
- `POST /submit_feedback` - принимает оценку/комментарий и отправляет в LangSmith

Поток `/agent` содержит промежуточные статусные сообщения и финальное событие `final_result` с полями:

- `answer`
- `used_context`
- `trace_id`
- `shopping_cart`

## Frontend (Streamlit)

Frontend отправляет запросы в `/agent`, читает SSE-поток, отображает прогресс выполнения, итоговый ответ, найденные товары и текущее состояние корзины. Отдельно поддержан feedback-цикл (thumbs up/down + текст), который уходит в `/submit_feedback`.

## Хранилища и операционные данные

Система использует PostgreSQL в двух ролях:

- `langgraph_db` - checkpointing графа и память диалогов
- `tools_database` - прикладные данные инструментов (корзина и склад)

Рабочие таблицы:

- `shopping_carts.shopping_cart_items`
- `warehouses.inventory`

SQL-схемы находятся в:

- `scripts/sql/shopping_cart_table.sql`
- `scripts/sql/warehouse_management.sql`

## Наблюдаемость и оценка качества

Для трассировок и feedback используется LangSmith. Для оценки retrieval/answer есть отдельный eval-скрипт:

- `apps/api/evals/eval_retriever.py`

Запуск:

```bash
make run-evals-retriever
```

## Поток пользовательского запроса

![Sequence Diagram](sequence_diagram.png)

1. Пользователь вводит сообщение в Streamlit UI.
2. UI отправляет `POST /agent` в FastAPI с `query` и `thread_id`, запрашивая `text/event-stream`.
3. FastAPI запускает LangGraph workflow и передает туда начальное состояние диалога.
4. `coordinator_agent` анализирует запрос и решает, какой специализированный агент нужен следующим:
   - `product_qa_agent` для товарных вопросов и отзывов,
   - `shopping_cart_agent` для операций корзины,
   - `warehouse_manager_agent` для проверки/резерва склада.
5. Выбранный агент при необходимости вызывает свои tools (через tool node), получает результаты и возвращает их в граф.
6. Управление снова возвращается координатору, который либо делегирует следующий шаг, либо завершает выполнение финальным ответом.
7. Пока граф работает, API стримит в UI промежуточные статусные сообщения (SSE).
8. В конце API отправляет финальное SSE-событие `final_result` с:
   - `answer`,
   - `used_context`,
   - `trace_id`,
   - `shopping_cart`.
9. UI отображает пользователю итоговый ответ, найденные товары и текущее состояние корзины.
10. Если пользователь оставляет оценку/комментарий, UI отправляет `POST /submit_feedback`, а backend записывает feedback в LangSmith по `trace_id`.

## Структура репозитория

```text
apps/
  api/               FastAPI backend + LangGraph agents
  chatbot_ui/        Streamlit UI
scripts/sql/         SQL схемы корзины и склада
docs/                Диаграммы и дополнительные материалы
docker-compose.yml
```

## Быстрый запуск

Из корня репозитория:

```bash
cp env.example .env
docker compose up --build
```

После старта доступны:

- UI: `http://localhost:8501`
- API docs: `http://localhost:8000/docs`
- Qdrant: `http://localhost:6333`
- Postgres: `localhost:5433`

## Обязательная инициализация tools_database

Один раз после запуска контейнеров:

```powershell
docker compose exec postgres psql -U langgraph_user -d postgres -c "CREATE DATABASE tools_database;"
Get-Content scripts/sql/shopping_cart_table.sql | docker compose exec -T postgres psql -U langgraph_user -d tools_database
Get-Content scripts/sql/warehouse_management.sql | docker compose exec -T postgres psql -U langgraph_user -d tools_database
```
