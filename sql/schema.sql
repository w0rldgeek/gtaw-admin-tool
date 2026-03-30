-- ============================================================
-- GTAW Admin Tool — Punishment Analysis System
-- Database Schema for Supabase (PostgreSQL)
-- ============================================================

-- Расширения
CREATE EXTENSION IF NOT EXISTS "pg_trgm";  -- для fuzzy-поиска по текстам

-- ============================================================
-- 1. PLAYERS — Профили игроков
-- ============================================================
CREATE TABLE IF NOT EXISTS players (
    id              BIGSERIAL PRIMARY KEY,
    nickname        TEXT NOT NULL,                          -- "Имя Фамилия"
    external_id     TEXT,                                   -- ID игрока на сайте проекта
    profile_url     TEXT,                                   -- Ссылка на профиль
    server_name     TEXT DEFAULT 'main',                    -- Название сервера
    avatar_url      TEXT,                                   -- URL аватара
    extra_data      JSONB DEFAULT '{}'::jsonb,              -- Дополнительные данные профиля
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now(),
    last_synced_at  TIMESTAMPTZ,

    -- Уникальность: один никнейм на сервере
    CONSTRAINT uq_players_nickname_server UNIQUE (nickname, server_name)
);

CREATE INDEX idx_players_nickname ON players USING gin (nickname gin_trgm_ops);
CREATE INDEX idx_players_server ON players (server_name);
CREATE INDEX idx_players_last_synced ON players (last_synced_at);

-- ============================================================
-- 2. PUNISHMENTS — Серверные наказания
-- ============================================================
CREATE TABLE IF NOT EXISTS punishments (
    id                  BIGSERIAL PRIMARY KEY,
    player_id           BIGINT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    punishment_date     TIMESTAMPTZ,                        -- Дата наказания
    reason_raw          TEXT NOT NULL,                       -- Оригинальная причина (как на сайте)
    reason_normalized   TEXT,                                -- Нормализованная причина (lowercase, trimmed)
    admin_name          TEXT,                                -- Имя администратора
    punishment_term_raw TEXT,                                -- Срок как строка ("60 минут", "ban 3 days")
    punishment_type     TEXT,                                -- Тип: demorgan, ban, warn, kick, jail, mute
    punishment_minutes  INTEGER,                             -- Срок в минутах (для сортировки/сравнения)
    is_active           BOOLEAN DEFAULT false,               -- Активно ли наказание сейчас
    source_url          TEXT,                                -- URL страницы-источника
    source_hash         TEXT,                                -- SHA256 хеш для дедупликации
    extra_data          JSONB DEFAULT '{}'::jsonb,           -- Дополнительные данные
    created_at          TIMESTAMPTZ DEFAULT now(),
    updated_at          TIMESTAMPTZ DEFAULT now(),

    -- Дедупликация: один и тот же punishment не записывается дважды
    CONSTRAINT uq_punishments_hash UNIQUE (source_hash)
);

CREATE INDEX idx_punishments_player ON punishments (player_id);
CREATE INDEX idx_punishments_date ON punishments (punishment_date DESC);
CREATE INDEX idx_punishments_type ON punishments (punishment_type);
CREATE INDEX idx_punishments_reason ON punishments USING gin (reason_normalized gin_trgm_ops);

-- ============================================================
-- 3. RULES — Правила сервера
-- ============================================================
CREATE TABLE IF NOT EXISTS rules (
    id                  BIGSERIAL PRIMARY KEY,
    rule_code           TEXT NOT NULL UNIQUE,                -- "4.3", "7.1" и т.д.
    title               TEXT NOT NULL,                       -- "DM", "MG" и т.д.
    description         TEXT,                                -- Полное описание правила
    category            TEXT,                                -- Категория: roleplay, chat, cheat и т.д.
    base_punishment     TEXT,                                -- Срок за первое нарушение
    base_minutes        INTEGER,                             -- В минутах
    repeat_punishment   TEXT,                                -- Срок за повторное
    repeat_minutes      INTEGER,
    multiple_punishment TEXT,                                -- Срок за многократное (3+)
    multiple_minutes    INTEGER,
    keywords            TEXT[] DEFAULT '{}',                  -- Ключевые слова для поиска
    aliases             TEXT[] DEFAULT '{}',                  -- Алиасы / альтернативные названия
    examples            TEXT[] DEFAULT '{}',                  -- Примеры формулировок причин
    severity            INTEGER DEFAULT 1,                   -- 1-5, приоритет серьёзности
    server_name         TEXT DEFAULT 'main',                 -- Для разных серверов — разные правила
    is_active           BOOLEAN DEFAULT true,
    notes               TEXT,                                -- Заметки для администраторов
    created_at          TIMESTAMPTZ DEFAULT now(),
    updated_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_rules_code ON rules (rule_code);
CREATE INDEX idx_rules_server ON rules (server_name);
CREATE INDEX idx_rules_keywords ON rules USING gin (keywords);
CREATE INDEX idx_rules_aliases ON rules USING gin (aliases);

-- ============================================================
-- 4. ANALYSIS_RESULTS — Результаты анализа
-- ============================================================
CREATE TABLE IF NOT EXISTS analysis_results (
    id                      BIGSERIAL PRIMARY KEY,
    player_id               BIGINT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    analyst_user_id         UUID REFERENCES auth.users(id),  -- Кто запускал анализ
    queried_reason          TEXT NOT NULL,                    -- Что ввёл администратор
    queried_reason_normalized TEXT,                           -- Нормализованная версия
    matched_rule_id         BIGINT REFERENCES rules(id),     -- Найденное правило
    matched_rule_code       TEXT,                             -- Код правила (для быстрого доступа)
    confidence_score        REAL DEFAULT 0,                   -- 0.0 - 1.0
    repeat_count            INTEGER DEFAULT 0,               -- Количество предыдущих аналогичных нарушений
    similar_punishments     JSONB DEFAULT '[]'::jsonb,       -- Список похожих наказаний из истории
    recommended_punishment  TEXT,                             -- Рекомендуемое наказание текстом
    recommended_minutes     INTEGER,                         -- Рекомендуемый срок в минутах
    explanation             TEXT,                             -- Объяснение логики
    alternatives            JSONB DEFAULT '[]'::jsonb,       -- Альтернативные совпадения
    is_manual_override      BOOLEAN DEFAULT false,           -- Администратор выбрал вручную
    manual_rule_id          BIGINT REFERENCES rules(id),     -- Если выбрал вручную — какое правило
    created_at              TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_analysis_player ON analysis_results (player_id);
CREATE INDEX idx_analysis_analyst ON analysis_results (analyst_user_id);
CREATE INDEX idx_analysis_rule ON analysis_results (matched_rule_id);
CREATE INDEX idx_analysis_created ON analysis_results (created_at DESC);

-- ============================================================
-- 5. SYNC_LOG — Журнал синхронизаций из Tampermonkey
-- ============================================================
CREATE TABLE IF NOT EXISTS sync_log (
    id              BIGSERIAL PRIMARY KEY,
    player_id       BIGINT REFERENCES players(id) ON DELETE SET NULL,
    user_id         UUID REFERENCES auth.users(id),         -- Кто инициировал
    sync_type       TEXT NOT NULL,                           -- manual_parse, search_parse, resync
    status          TEXT DEFAULT 'pending',                  -- pending, running, done, error
    punishments_found   INTEGER DEFAULT 0,
    punishments_new     INTEGER DEFAULT 0,
    error_message   TEXT,
    source_url      TEXT,
    duration_ms     INTEGER,
    created_at      TIMESTAMPTZ DEFAULT now(),
    finished_at     TIMESTAMPTZ
);

CREATE INDEX idx_sync_player ON sync_log (player_id);
CREATE INDEX idx_sync_status ON sync_log (status);
CREATE INDEX idx_sync_created ON sync_log (created_at DESC);

-- ============================================================
-- 6. PARSE_REQUESTS — Запросы на парсинг (сайт → Tampermonkey)
-- ============================================================
CREATE TABLE IF NOT EXISTS parse_requests (
    id              BIGSERIAL PRIMARY KEY,
    user_id         UUID REFERENCES auth.users(id),
    nickname        TEXT NOT NULL,
    server_name     TEXT DEFAULT 'main',
    status          TEXT DEFAULT 'pending',                  -- pending, running, done, error
    error_message   TEXT,
    created_at      TIMESTAMPTZ DEFAULT now(),
    started_at      TIMESTAMPTZ,
    finished_at     TIMESTAMPTZ
);

CREATE INDEX idx_parse_requests_status ON parse_requests (status);
CREATE INDEX idx_parse_requests_created ON parse_requests (created_at DESC);

-- ============================================================
-- FUNCTIONS
-- ============================================================

-- Функция upsert для игрока (возвращает id)
CREATE OR REPLACE FUNCTION upsert_player(
    p_nickname TEXT,
    p_server_name TEXT DEFAULT 'main',
    p_external_id TEXT DEFAULT NULL,
    p_profile_url TEXT DEFAULT NULL,
    p_avatar_url TEXT DEFAULT NULL,
    p_extra_data JSONB DEFAULT '{}'::jsonb
) RETURNS BIGINT AS $$
DECLARE
    v_id BIGINT;
BEGIN
    INSERT INTO players (nickname, server_name, external_id, profile_url, avatar_url, extra_data, last_synced_at, updated_at)
    VALUES (p_nickname, p_server_name, p_external_id, p_profile_url, p_avatar_url, p_extra_data, now(), now())
    ON CONFLICT (nickname, server_name)
    DO UPDATE SET
        external_id = COALESCE(EXCLUDED.external_id, players.external_id),
        profile_url = COALESCE(EXCLUDED.profile_url, players.profile_url),
        avatar_url = COALESCE(EXCLUDED.avatar_url, players.avatar_url),
        extra_data = players.extra_data || EXCLUDED.extra_data,
        last_synced_at = now(),
        updated_at = now()
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Функция upsert для наказания (с дедупликацией по hash)
CREATE OR REPLACE FUNCTION upsert_punishment(
    p_player_id BIGINT,
    p_punishment_date TIMESTAMPTZ,
    p_reason_raw TEXT,
    p_admin_name TEXT,
    p_punishment_term_raw TEXT,
    p_punishment_type TEXT,
    p_punishment_minutes INTEGER DEFAULT NULL,
    p_is_active BOOLEAN DEFAULT false,
    p_source_url TEXT DEFAULT NULL,
    p_source_hash TEXT DEFAULT NULL,
    p_extra_data JSONB DEFAULT '{}'::jsonb
) RETURNS BIGINT AS $$
DECLARE
    v_id BIGINT;
    v_normalized TEXT;
BEGIN
    -- Нормализуем причину
    v_normalized := lower(trim(regexp_replace(p_reason_raw, '\s+', ' ', 'g')));

    INSERT INTO punishments (
        player_id, punishment_date, reason_raw, reason_normalized,
        admin_name, punishment_term_raw, punishment_type, punishment_minutes,
        is_active, source_url, source_hash, extra_data, updated_at
    ) VALUES (
        p_player_id, p_punishment_date, p_reason_raw, v_normalized,
        p_admin_name, p_punishment_term_raw, p_punishment_type, p_punishment_minutes,
        p_is_active, p_source_url, p_source_hash, p_extra_data, now()
    )
    ON CONFLICT (source_hash) DO UPDATE SET
        punishment_date = COALESCE(EXCLUDED.punishment_date, punishments.punishment_date),
        reason_raw = EXCLUDED.reason_raw,
        reason_normalized = EXCLUDED.reason_normalized,
        admin_name = COALESCE(EXCLUDED.admin_name, punishments.admin_name),
        punishment_term_raw = COALESCE(EXCLUDED.punishment_term_raw, punishments.punishment_term_raw),
        punishment_type = COALESCE(EXCLUDED.punishment_type, punishments.punishment_type),
        punishment_minutes = COALESCE(EXCLUDED.punishment_minutes, punishments.punishment_minutes),
        is_active = EXCLUDED.is_active,
        updated_at = now()
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Функция для массового upsert наказаний (Tampermonkey отправляет пачку)
CREATE OR REPLACE FUNCTION bulk_upsert_punishments(
    p_player_nickname TEXT,
    p_server_name TEXT,
    p_profile_url TEXT,
    p_external_id TEXT,
    p_punishments JSONB
) RETURNS JSONB AS $$
DECLARE
    v_player_id BIGINT;
    v_count INTEGER := 0;
    v_new INTEGER := 0;
    v_item JSONB;
    v_result BIGINT;
    v_existing BOOLEAN;
BEGIN
    -- Upsert игрока
    v_player_id := upsert_player(p_player_nickname, p_server_name, p_external_id, p_profile_url);

    -- Upsert каждое наказание
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_punishments)
    LOOP
        v_count := v_count + 1;

        -- Проверяем, существует ли уже
        SELECT EXISTS(
            SELECT 1 FROM punishments WHERE source_hash = v_item->>'source_hash'
        ) INTO v_existing;

        v_result := upsert_punishment(
            p_player_id := v_player_id,
            p_punishment_date := (v_item->>'punishment_date')::TIMESTAMPTZ,
            p_reason_raw := v_item->>'reason_raw',
            p_admin_name := v_item->>'admin_name',
            p_punishment_term_raw := v_item->>'punishment_term_raw',
            p_punishment_type := v_item->>'punishment_type',
            p_punishment_minutes := (v_item->>'punishment_minutes')::INTEGER,
            p_is_active := COALESCE((v_item->>'is_active')::BOOLEAN, false),
            p_source_url := v_item->>'source_url',
            p_source_hash := v_item->>'source_hash',
            p_extra_data := COALESCE(v_item->'extra_data', '{}'::jsonb)
        );

        IF NOT v_existing THEN
            v_new := v_new + 1;
        END IF;
    END LOOP;

    RETURN jsonb_build_object(
        'player_id', v_player_id,
        'total_processed', v_count,
        'new_punishments', v_new
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Триггер обновления updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_players_updated_at
    BEFORE UPDATE ON players FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_punishments_updated_at
    BEFORE UPDATE ON punishments FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_rules_updated_at
    BEFORE UPDATE ON rules FOR EACH ROW EXECUTE FUNCTION update_updated_at();
