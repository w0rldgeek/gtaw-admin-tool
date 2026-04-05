-- ============================================================
-- Migration V2: parsed_profiles staging + characters table
-- ============================================================

-- 1. Staging-таблица для данных от Tampermonkey
-- Tampermonkey делает простой INSERT сюда, сайт обрабатывает
CREATE TABLE IF NOT EXISTS parsed_profiles (
    id              BIGSERIAL PRIMARY KEY,
    nickname        TEXT NOT NULL,
    external_id     TEXT,
    profile_url     TEXT,
    server_name     TEXT DEFAULT 'main',
    raw_data        JSONB NOT NULL,                     -- { punishments: [], characters: [], parsed_at: ... }
    status          TEXT DEFAULT 'pending',              -- pending | processed | error
    error_message   TEXT,
    created_at      TIMESTAMPTZ DEFAULT now(),
    processed_at    TIMESTAMPTZ
);

CREATE INDEX idx_parsed_profiles_status ON parsed_profiles (status);
CREATE INDEX idx_parsed_profiles_created ON parsed_profiles (created_at DESC);

-- 2. Таблица персонажей
CREATE TABLE IF NOT EXISTS characters (
    id              BIGSERIAL PRIMARY KEY,
    player_id       BIGINT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    character_name  TEXT NOT NULL,
    character_id    TEXT,                                -- ID персонажа из URL
    is_active       BOOLEAN DEFAULT true,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now(),

    CONSTRAINT uq_characters_player_name UNIQUE (player_id, character_name)
);

CREATE INDEX idx_characters_player ON characters (player_id);

-- Триггер updated_at для characters
CREATE TRIGGER trg_characters_updated_at
    BEFORE UPDATE ON characters FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 3. RLS
ALTER TABLE parsed_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE characters ENABLE ROW LEVEL SECURITY;

-- parsed_profiles: anon может вставлять, все могут читать
CREATE POLICY "parsed_profiles_select_all" ON parsed_profiles FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "parsed_profiles_insert_anon" ON parsed_profiles FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "parsed_profiles_update_all" ON parsed_profiles FOR UPDATE TO anon, authenticated USING (true);

-- characters: все читают, вставка/обновление для всех
CREATE POLICY "characters_select_all" ON characters FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "characters_insert_all" ON characters FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "characters_update_all" ON characters FOR UPDATE TO anon, authenticated USING (true);
CREATE POLICY "characters_delete_all" ON characters FOR DELETE TO anon, authenticated USING (true);

-- 4. Колонки четвёртого наказания (если ещё нет)
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='rules' AND column_name='fourth_punishment') THEN
        ALTER TABLE rules ADD COLUMN fourth_punishment TEXT;
        ALTER TABLE rules ADD COLUMN fourth_minutes INTEGER;
    END IF;
END $$;
