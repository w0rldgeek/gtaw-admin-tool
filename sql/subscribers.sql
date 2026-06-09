-- ============================================================
-- GTAW Admin Tool — Актуализация номеров абонентов
-- Таблица "subscribers" (онлайн-аналог Google-таблицы)
-- ============================================================
-- Данные вносятся через сайт: адрес, логин, дата, номер телефона.
-- На странице записи группируются по месяцам и подсвечиваются разными
-- цветами (логика отображения — на фронтенде).
-- ============================================================

CREATE TABLE IF NOT EXISTS subscribers (
    id                  BIGSERIAL PRIMARY KEY,
    address             TEXT NOT NULL,                       -- Адрес абонента
    login               TEXT NOT NULL,                       -- Логин абонента
    phone_number        TEXT NOT NULL,                       -- Номер телефона
    subscription_date   DATE NOT NULL DEFAULT CURRENT_DATE,  -- Дата (по ней — группировка по месяцам)
    notes               TEXT,                                -- Необязательная заметка
    user_id             UUID REFERENCES auth.users(id),      -- Кто внёс запись (если авторизован)
    created_at          TIMESTAMPTZ DEFAULT now(),
    updated_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscribers_date ON subscribers (subscription_date DESC);
CREATE INDEX IF NOT EXISTS idx_subscribers_login ON subscribers (login);
CREATE INDEX IF NOT EXISTS idx_subscribers_phone ON subscribers (phone_number);

-- Триггер обновления updated_at (функция update_updated_at объявлена в schema.sql)
DROP TRIGGER IF EXISTS trg_subscribers_updated_at ON subscribers;
CREATE TRIGGER trg_subscribers_updated_at
    BEFORE UPDATE ON subscribers FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- RLS Policies — в духе остальных таблиц проекта (открытый доступ)
-- ============================================================
ALTER TABLE subscribers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "subscribers_select_authenticated"
    ON subscribers FOR SELECT TO authenticated USING (true);
CREATE POLICY "subscribers_select_anon"
    ON subscribers FOR SELECT TO anon USING (true);

CREATE POLICY "subscribers_insert_authenticated"
    ON subscribers FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "subscribers_insert_anon"
    ON subscribers FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "subscribers_update_authenticated"
    ON subscribers FOR UPDATE TO authenticated USING (true);
CREATE POLICY "subscribers_update_anon"
    ON subscribers FOR UPDATE TO anon USING (true);

CREATE POLICY "subscribers_delete_authenticated"
    ON subscribers FOR DELETE TO authenticated USING (true);
CREATE POLICY "subscribers_delete_anon"
    ON subscribers FOR DELETE TO anon USING (true);
