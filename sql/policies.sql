-- ============================================================
-- RLS Policies — Row Level Security
-- ============================================================

-- Включаем RLS на всех таблицах
ALTER TABLE players ENABLE ROW LEVEL SECURITY;
ALTER TABLE punishments ENABLE ROW LEVEL SECURITY;
ALTER TABLE rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE analysis_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE parse_requests ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- PLAYERS: все авторизованные пользователи могут читать
-- Записывать могут все авторизованные (через RPC-функции SECURITY DEFINER)
-- ============================================================
CREATE POLICY "players_select_authenticated"
    ON players FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "players_insert_authenticated"
    ON players FOR INSERT
    TO authenticated
    WITH CHECK (true);

CREATE POLICY "players_update_authenticated"
    ON players FOR UPDATE
    TO authenticated
    USING (true);

-- ============================================================
-- PUNISHMENTS: все авторизованные читают, вставка через RPC
-- ============================================================
CREATE POLICY "punishments_select_authenticated"
    ON punishments FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "punishments_insert_authenticated"
    ON punishments FOR INSERT
    TO authenticated
    WITH CHECK (true);

CREATE POLICY "punishments_update_authenticated"
    ON punishments FOR UPDATE
    TO authenticated
    USING (true);

-- ============================================================
-- RULES: все авторизованные читают, только admin пишет
-- (проверка роли через таблицу profiles из основного проекта)
-- ============================================================
CREATE POLICY "rules_select_authenticated"
    ON rules FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "rules_select_anon"
    ON rules FOR SELECT
    TO anon
    USING (true);

-- Для записи правил — только admin
CREATE POLICY "rules_insert_admin"
    ON rules FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role = 'admin'
        )
    );

CREATE POLICY "rules_update_admin"
    ON rules FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role = 'admin'
        )
    );

CREATE POLICY "rules_delete_admin"
    ON rules FOR DELETE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role = 'admin'
        )
    );

-- ============================================================
-- ANALYSIS_RESULTS: пользователь видит свои + чужие результаты
-- ============================================================
CREATE POLICY "analysis_select_authenticated"
    ON analysis_results FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "analysis_insert_authenticated"
    ON analysis_results FOR INSERT
    TO authenticated
    WITH CHECK (analyst_user_id = auth.uid());

-- ============================================================
-- SYNC_LOG: все авторизованные читают, вставка с привязкой к пользователю
-- ============================================================
CREATE POLICY "sync_log_select_authenticated"
    ON sync_log FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "sync_log_insert_authenticated"
    ON sync_log FOR INSERT
    TO authenticated
    WITH CHECK (true);

CREATE POLICY "sync_log_update_authenticated"
    ON sync_log FOR UPDATE
    TO authenticated
    USING (true);

-- ============================================================
-- PARSE_REQUESTS: создавать может любой, читать — свои
-- Tampermonkey обновляет статус
-- ============================================================
CREATE POLICY "parse_requests_select_authenticated"
    ON parse_requests FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "parse_requests_insert_authenticated"
    ON parse_requests FOR INSERT
    TO authenticated
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "parse_requests_update_authenticated"
    ON parse_requests FOR UPDATE
    TO authenticated
    USING (true);
