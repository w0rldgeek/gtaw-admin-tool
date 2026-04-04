/**
 * ============================================================
 * GTAW Admin Tool — Main Application
 * ============================================================
 *
 * Vanilla JS SPA: Supabase + AnalysisEngine
 * Страницы: Поиск | Анализ | Правила | История | Синхронизации | Настройки
 * ============================================================
 */

(function () {
    'use strict';

    // ============================================================
    // CONFIG & STATE
    // ============================================================

    const STORAGE_KEY = 'gat_config_v1';
    const DEFAULT_SUPA_URL = ''; // Заполнить при деплое, или пусть пользователь введёт
    const DEFAULT_SUPA_KEY = '';

    let supabaseClient = null;
    let currentUser = null;

    // Кэшированные данные
    let cachedRules = [];
    let currentPlayer = null;
    let currentPunishments = [];

    // ============================================================
    // SUPABASE INIT
    // ============================================================

    function getConfig() {
        try {
            return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
        } catch { return {}; }
    }

    function saveConfig(cfg) {
        const existing = getConfig();
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...existing, ...cfg }));
    }

    function initSupabase() {
        const cfg = getConfig();
        const url = cfg.supabaseUrl || DEFAULT_SUPA_URL;
        const key = cfg.supabaseKey || DEFAULT_SUPA_KEY;

        if (!url || !key) {
            setConnectionStatus('warning', 'Не настроено');
            return false;
        }

        try {
            supabaseClient = window.supabase.createClient(url, key);
            setConnectionStatus('success', 'Подключено');
            return true;
        } catch (e) {
            console.error('Supabase init error:', e);
            setConnectionStatus('danger', 'Ошибка');
            return false;
        }
    }

    async function checkAuth() {
        if (!supabaseClient) return;
        try {
            const { data: { session } } = await supabaseClient.auth.getSession();
            if (session?.user) {
                currentUser = session.user;
                document.getElementById('user-name').textContent =
                    session.user.email || session.user.user_metadata?.name || 'Пользователь';
                document.getElementById('user-avatar').textContent = '✅';
            }
        } catch (e) {
            console.error('Auth check error:', e);
        }
    }

    function setConnectionStatus(type, text) {
        const el = document.getElementById('connection-status');
        el.className = `badge badge-${type}`;
        el.textContent = text;
    }

    // ============================================================
    // NAVIGATION
    // ============================================================

    function navigate(page) {
        // Скрываем все страницы
        document.querySelectorAll('.page').forEach(p => p.style.display = 'none');

        // Показываем нужную
        const pageEl = document.getElementById(`page-${page}`);
        if (pageEl) pageEl.style.display = 'block';

        // Обновляем навигацию
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        const navItem = document.querySelector(`.nav-item[data-page="${page}"]`);
        if (navItem) navItem.classList.add('active');

        // Обновляем заголовок
        const titles = {
            search: 'Поиск игрока',
            analysis: 'Анализ нарушений',
            rules: 'База правил',
            history: 'История анализов',
            sync: 'Синхронизации',
            settings: 'Настройки',
        };
        document.getElementById('page-title').textContent = titles[page] || page;

        // Загружаем данные для страницы
        if (page === 'rules') loadRules();
        if (page === 'history') loadHistory();
        if (page === 'sync') loadSyncLog();
    }

    // ============================================================
    // TOAST
    // ============================================================

    function toast(message, type = 'info', duration = 4000) {
        const container = document.getElementById('toast-container');
        const el = document.createElement('div');
        el.className = `toast ${type}`;
        el.textContent = message;
        container.appendChild(el);
        setTimeout(() => {
            el.style.opacity = '0';
            el.style.transform = 'translateX(40px)';
            el.style.transition = 'all 0.3s ease';
            setTimeout(() => el.remove(), 300);
        }, duration);
    }

    // ============================================================
    // SEARCH PLAYER
    // ============================================================

    async function searchPlayer(nickname) {
        if (!supabaseClient) {
            toast('Supabase не настроен', 'error');
            return;
        }

        nickname = nickname.trim();
        if (!nickname) {
            toast('Введите никнейм', 'warning');
            return;
        }

        toast('Ищу игрока...', 'info');

        try {
            // Ищем игрока в базе
            const { data: players, error } = await supabaseClient
                .from('players')
                .select('*')
                .ilike('nickname', `%${nickname}%`)
                .limit(1);

            if (error) throw error;

            if (!players || players.length === 0) {
                toast('Игрок не найден. Запросите парсинг через Tampermonkey.', 'warning');
                document.getElementById('player-card').style.display = 'none';
                return;
            }

            const player = players[0];
            currentPlayer = player;

            // Загружаем наказания
            const { data: punishments, error: pErr } = await supabaseClient
                .from('punishments')
                .select('*')
                .eq('player_id', player.id)
                .order('punishment_date', { ascending: false });

            if (pErr) throw pErr;

            currentPunishments = punishments || [];

            // Отображаем карточку
            renderPlayerCard(player, currentPunishments);
            toast(`Найден: ${player.nickname} (${currentPunishments.length} наказаний)`, 'success');
        } catch (e) {
            console.error('Search error:', e);
            toast(`Ошибка поиска: ${e.message}`, 'error');
        }
    }

    function renderPlayerCard(player, punishments) {
        const card = document.getElementById('player-card');
        card.style.display = 'block';

        document.getElementById('player-name').textContent = player.nickname;
        document.getElementById('player-server').textContent = player.server_name || '—';
        document.getElementById('player-id').textContent = player.external_id || '—';
        document.getElementById('player-synced').textContent = player.last_synced_at
            ? new Date(player.last_synced_at).toLocaleString('ru-RU')
            : 'Никогда';
        document.getElementById('player-punishments-count').textContent = punishments.length;

        const profileLink = document.getElementById('player-profile-link');
        if (player.profile_url) {
            profileLink.href = player.profile_url;
            profileLink.style.display = 'inline-flex';
        } else {
            profileLink.style.display = 'none';
        }

        // Таблица наказаний
        const tbody = document.getElementById('punishments-tbody');
        if (punishments.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Нет наказаний</td></tr>';
            return;
        }

        tbody.innerHTML = punishments.map(p => `
            <tr>
                <td>${p.punishment_date ? new Date(p.punishment_date).toLocaleDateString('ru-RU') : '—'}</td>
                <td>${escapeHtml(p.reason_raw || '—')}</td>
                <td>${escapeHtml(p.admin_name || '—')}</td>
                <td>${escapeHtml(p.punishment_term_raw || '—')}</td>
                <td><span class="type-${p.punishment_type || 'demorgan'}">${p.punishment_type || '—'}</span></td>
            </tr>
        `).join('');
    }

    // ============================================================
    // REQUEST PARSE (сайт → Tampermonkey через Supabase)
    // ============================================================

    async function requestParse(nickname) {
        if (!supabaseClient) {
            toast('Supabase не настроен', 'error');
            return;
        }

        nickname = nickname.trim();
        if (!nickname) {
            toast('Введите никнейм', 'warning');
            return;
        }

        try {
            const { error } = await supabaseClient
                .from('parse_requests')
                .insert({
                    nickname,
                    user_id: currentUser?.id || null,
                    status: 'pending',
                });

            if (error) throw error;
            toast(`Запрос на парсинг "${nickname}" отправлен. Ожидайте...`, 'success');
        } catch (e) {
            toast(`Ошибка: ${e.message}`, 'error');
        }
    }

    // ============================================================
    // ANALYSIS
    // ============================================================

    async function runAnalysis() {
        const playerNickname = document.getElementById('analysis-player').value.trim();
        const reason = document.getElementById('analysis-reason').value.trim();

        if (!reason) {
            toast('Введите причину нарушения', 'warning');
            return;
        }

        // Загружаем правила, если ещё не загружены
        if (cachedRules.length === 0) {
            await loadRulesData();
        }

        // Загружаем наказания игрока (если указан)
        let playerPunishments = [];
        let playerId = null;

        if (playerNickname) {
            try {
                const { data: players } = await supabaseClient
                    .from('players')
                    .select('id')
                    .ilike('nickname', playerNickname)
                    .limit(1);

                if (players && players.length > 0) {
                    playerId = players[0].id;
                    const { data: puns } = await supabaseClient
                        .from('punishments')
                        .select('*')
                        .eq('player_id', playerId)
                        .order('punishment_date', { ascending: false });

                    playerPunishments = puns || [];
                }
            } catch (e) {
                console.error('Error loading player punishments:', e);
            }
        } else if (currentPlayer && currentPunishments.length > 0) {
            playerId = currentPlayer.id;
            playerPunishments = currentPunishments;
        }

        // Запускаем анализ
        const result = AnalysisEngine.analyze(reason, playerPunishments, cachedRules);

        // Отображаем результат
        renderAnalysisResult(result);

        // Сохраняем в историю
        await saveAnalysisResult(result, playerId);

        toast('Анализ завершён', 'success');
    }

    function renderAnalysisResult(result) {
        const container = document.getElementById('analysis-result');
        container.style.display = 'block';

        // Правило
        if (result.matchedRule) {
            document.getElementById('result-rule-code').textContent = result.matchedRule.rule_code;
            document.getElementById('result-rule-title').textContent = result.matchedRule.title;
            document.getElementById('result-rule-desc').textContent = result.matchedRule.description || '';
        } else {
            document.getElementById('result-rule-code').textContent = '?';
            document.getElementById('result-rule-title').textContent = 'Правило не определено';
            document.getElementById('result-rule-desc').textContent = 'Не удалось сопоставить причину с правилами сервера.';
        }

        // Confidence bar
        const confPercent = Math.round(result.confidence * 100);
        const confFill = document.getElementById('result-confidence-fill');
        confFill.style.width = `${confPercent}%`;
        confFill.style.background = confPercent >= 70 ? 'var(--success)' :
            confPercent >= 40 ? 'var(--warning)' : 'var(--danger)';
        document.getElementById('result-confidence-text').textContent = `${confPercent}%`;

        // Рекомендация
        document.getElementById('result-rec-term').textContent = result.recommendedPunishment;
        const badge = document.getElementById('result-rec-badge');
        const categoryLabels = { first: 'Первое', repeat: 'Второе', multiple: 'Третье', fourth: 'Четвёртое (4+)', unknown: '?' };
        badge.textContent = categoryLabels[result.recommendedCategory] || '?';
        badge.className = `rec-badge ${result.recommendedCategory}`;

        // Объяснение
        document.getElementById('result-explanation').textContent = result.explanation;

        // Похожие наказания
        const similarContainer = document.getElementById('similar-punishments-list');
        if (result.similarPunishments.length > 0) {
            similarContainer.innerHTML = result.similarPunishments.slice(0, 10).map(p => `
                <div class="similar-item">
                    <div class="similar-info">
                        <div class="similar-reason">${escapeHtml(p.reason_raw || '—')}</div>
                        <div class="similar-meta">
                            ${p.punishment_date ? new Date(p.punishment_date).toLocaleDateString('ru-RU') : '?'}
                            ${p.admin_name ? ` | ${escapeHtml(p.admin_name)}` : ''}
                        </div>
                    </div>
                    <div class="similar-term">${escapeHtml(p.punishment_term_raw || '—')}</div>
                </div>
            `).join('');
        } else {
            similarContainer.innerHTML = '<div class="empty-state">Нет похожих наказаний в истории</div>';
        }

        // Альтернативы
        const altContainer = document.getElementById('alternatives-list');
        if (result.alternatives.length > 0) {
            altContainer.innerHTML = result.alternatives.map(a => `
                <div class="alt-item" data-rule-code="${escapeHtml(a.ruleCode)}">
                    <div class="alt-info">
                        <span class="alt-code">${escapeHtml(a.ruleCode)}</span>
                        <span class="alt-title">${escapeHtml(a.title)}</span>
                    </div>
                    <span class="alt-confidence">${Math.round(a.confidence * 100)}%</span>
                </div>
            `).join('');

            // Клик по альтернативе — применить это правило
            altContainer.querySelectorAll('.alt-item').forEach(el => {
                el.addEventListener('click', () => {
                    const ruleCode = el.dataset.ruleCode;
                    applyManualRule(ruleCode);
                });
            });
        } else {
            altContainer.innerHTML = '<div class="empty-state">Нет альтернатив</div>';
        }

        // Заполняем dropdown ручного выбора
        fillManualRuleSelect();

        // Скроллим к результату
        container.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function fillManualRuleSelect() {
        const select = document.getElementById('manual-rule-select');
        select.innerHTML = '<option value="">— Оставить автоматический выбор —</option>';
        cachedRules
            .filter(r => r.is_active !== false)
            .sort((a, b) => a.rule_code.localeCompare(b.rule_code, undefined, { numeric: true }))
            .forEach(r => {
                const opt = document.createElement('option');
                opt.value = r.rule_code;
                opt.textContent = `${r.rule_code} — ${r.title}`;
                select.appendChild(opt);
            });
    }

    function applyManualRule(ruleCode) {
        const reason = document.getElementById('analysis-reason').value.trim();
        if (!reason) return;

        const playerPunishments = currentPunishments || [];
        const result = AnalysisEngine.analyzeWithManualRule(reason, playerPunishments, cachedRules, ruleCode);
        renderAnalysisResult(result);
        toast(`Применено правило ${ruleCode}`, 'info');
    }

    async function saveAnalysisResult(result, playerId) {
        if (!supabaseClient || !playerId) return;

        try {
            await supabaseClient.from('analysis_results').insert({
                player_id: playerId,
                analyst_user_id: currentUser?.id || null,
                queried_reason: result.queriedReason,
                queried_reason_normalized: result.queriedReasonNormalized,
                matched_rule_id: result.matchedRule?.id || null,
                matched_rule_code: result.matchedRuleCode,
                confidence_score: result.confidence,
                repeat_count: result.repeatCount,
                similar_punishments: result.similarPunishments.slice(0, 20),
                recommended_punishment: result.recommendedPunishment,
                recommended_minutes: result.recommendedMinutes,
                explanation: result.explanation,
                alternatives: result.alternatives,
                is_manual_override: result.isManualOverride || false,
            });
        } catch (e) {
            console.error('Error saving analysis result:', e);
        }
    }

    // ============================================================
    // COPY RECOMMENDATION
    // ============================================================

    function copyRecommendation() {
        const term = document.getElementById('result-rec-term').textContent;
        const ruleCode = document.getElementById('result-rule-code').textContent;
        const ruleTitle = document.getElementById('result-rule-title').textContent;
        const explanation = document.getElementById('result-explanation').textContent;

        const text = [
            `Правило: ${ruleCode} ${ruleTitle}`,
            `Рекомендуемое наказание: ${term}`,
            '',
            explanation,
        ].join('\n');

        navigator.clipboard.writeText(text).then(() => {
            toast('Рекомендация скопирована', 'success');
        }).catch(() => {
            toast('Ошибка копирования', 'error');
        });
    }

    // ============================================================
    // RULES PAGE
    // ============================================================

    async function loadRulesData() {
        if (!supabaseClient) return;
        try {
            const { data, error } = await supabaseClient
                .from('rules')
                .select('*')
                .order('rule_code', { ascending: true });

            if (error) throw error;
            cachedRules = data || [];
        } catch (e) {
            console.error('Error loading rules:', e);
            toast('Ошибка загрузки правил', 'error');
        }
    }

    async function loadRules() {
        await loadRulesData();
        renderRulesTable(cachedRules);
    }

    function renderRulesTable(rules) {
        const tbody = document.getElementById('rules-tbody');
        if (!rules || rules.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" class="empty-state">Правила не загружены</td></tr>';
            return;
        }

        tbody.innerHTML = rules.map(r => `
            <tr class="clickable" data-rule-id="${r.id}">
                <td><strong>${escapeHtml(r.rule_code)}</strong></td>
                <td>${escapeHtml(r.title)}</td>
                <td><span class="badge badge-neutral">${escapeHtml(r.category || '—')}</span></td>
                <td>${escapeHtml(r.base_punishment || '—')}</td>
                <td>${escapeHtml(r.repeat_punishment || '—')}</td>
                <td>${escapeHtml(r.multiple_punishment || '—')}</td>
                <td>${escapeHtml(r.fourth_punishment || '—')}</td>
                <td>${renderSeverity(r.severity || 1)}</td>
            </tr>
        `).join('');

        // Клик по строке — показать детали
        tbody.querySelectorAll('tr.clickable').forEach(row => {
            row.addEventListener('click', () => {
                const ruleId = parseInt(row.dataset.ruleId);
                const rule = cachedRules.find(r => r.id === ruleId);
                if (rule) renderRuleDetail(rule);
            });
        });
    }

    function renderSeverity(level) {
        return '<span class="severity">' +
            Array.from({ length: 5 }, (_, i) =>
                `<span class="severity-dot ${i < level ? `active-${level}` : ''}"></span>`
            ).join('') + '</span>';
    }

    function renderRuleDetail(rule) {
        const card = document.getElementById('rule-detail-card');
        card.style.display = 'block';

        document.getElementById('rule-detail-title').textContent = `${rule.rule_code} — ${rule.title}`;

        const body = document.getElementById('rule-detail-body');
        body.innerHTML = `
            <div class="rule-detail-grid">
                <div class="rule-detail-item rule-detail-full-width">
                    <span class="label">Описание</span>
                    <span class="value">${escapeHtml(rule.description || '—')}</span>
                </div>
                <div class="rule-detail-item">
                    <span class="label">Категория</span>
                    <span class="value">${escapeHtml(rule.category || '—')}</span>
                </div>
                <div class="rule-detail-item">
                    <span class="label">Серьёзность</span>
                    <span class="value">${renderSeverity(rule.severity || 1)} (${rule.severity || 1}/5)</span>
                </div>
                <div class="rule-detail-item">
                    <span class="label">Первое нарушение</span>
                    <span class="value">${escapeHtml(rule.base_punishment || '—')} (${rule.base_minutes || 0} мин)</span>
                </div>
                <div class="rule-detail-item">
                    <span class="label">Повторное</span>
                    <span class="value">${escapeHtml(rule.repeat_punishment || '—')} (${rule.repeat_minutes || 0} мин)</span>
                </div>
                <div class="rule-detail-item">
                    <span class="label">Третье нарушение</span>
                    <span class="value">${escapeHtml(rule.multiple_punishment || '—')} (${rule.multiple_minutes || 0} мин)</span>
                </div>
                <div class="rule-detail-item">
                    <span class="label">Четвёртое нарушение</span>
                    <span class="value">${escapeHtml(rule.fourth_punishment || '—')} (${rule.fourth_minutes || 0} мин)</span>
                </div>
                <div class="rule-detail-item">
                    <span class="label">Сервер</span>
                    <span class="value">${escapeHtml(rule.server_name || 'main')}</span>
                </div>
                <div class="rule-detail-item rule-detail-full-width">
                    <span class="label">Ключевые слова</span>
                    <div class="rule-tags">
                        ${(rule.keywords || []).map(k => `<span class="rule-tag">${escapeHtml(k)}</span>`).join('')}
                    </div>
                </div>
                <div class="rule-detail-item rule-detail-full-width">
                    <span class="label">Алиасы</span>
                    <div class="rule-tags">
                        ${(rule.aliases || []).map(a => `<span class="rule-tag">${escapeHtml(a)}</span>`).join('')}
                    </div>
                </div>
                <div class="rule-detail-item rule-detail-full-width">
                    <span class="label">Примеры формулировок</span>
                    <div class="rule-tags">
                        ${(rule.examples || []).map(e => `<span class="rule-tag">${escapeHtml(e)}</span>`).join('')}
                    </div>
                </div>
            </div>
        `;

        card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // ============================================================
    // HISTORY PAGE
    // ============================================================

    async function loadHistory() {
        if (!supabaseClient) return;

        try {
            const { data, error } = await supabaseClient
                .from('analysis_results')
                .select(`
                    *,
                    players(nickname)
                `)
                .order('created_at', { ascending: false })
                .limit(100);

            if (error) throw error;
            renderHistoryTable(data || []);
        } catch (e) {
            console.error('Error loading history:', e);
        }
    }

    function renderHistoryTable(results) {
        const tbody = document.getElementById('history-tbody');
        if (!results || results.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="empty-state">Нет записей</td></tr>';
            return;
        }

        tbody.innerHTML = results.map(r => `
            <tr>
                <td>${r.created_at ? new Date(r.created_at).toLocaleString('ru-RU') : '—'}</td>
                <td>${escapeHtml(r.players?.nickname || '—')}</td>
                <td>${escapeHtml(truncate(r.queried_reason || '', 40))}</td>
                <td><strong>${escapeHtml(r.matched_rule_code || '—')}</strong></td>
                <td>${r.repeat_count || 0}</td>
                <td>${escapeHtml(r.recommended_punishment || '—')}</td>
                <td>${r.confidence_score ? Math.round(r.confidence_score * 100) + '%' : '—'}</td>
            </tr>
        `).join('');
    }

    // ============================================================
    // SYNC LOG PAGE
    // ============================================================

    async function loadSyncLog() {
        if (!supabaseClient) return;

        try {
            const { data, error } = await supabaseClient
                .from('sync_log')
                .select(`
                    *,
                    players(nickname)
                `)
                .order('created_at', { ascending: false })
                .limit(100);

            if (error) throw error;
            renderSyncTable(data || []);
        } catch (e) {
            console.error('Error loading sync log:', e);
        }
    }

    function renderSyncTable(logs) {
        const tbody = document.getElementById('sync-tbody');
        if (!logs || logs.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Нет записей</td></tr>';
            return;
        }

        tbody.innerHTML = logs.map(l => `
            <tr>
                <td>${l.created_at ? new Date(l.created_at).toLocaleString('ru-RU') : '—'}</td>
                <td>${escapeHtml(l.players?.nickname || '—')}</td>
                <td>${escapeHtml(l.sync_type || '—')}</td>
                <td><span class="status-${l.status}">${l.status || '—'}</span></td>
                <td>${l.punishments_found ?? '—'}</td>
                <td>${l.punishments_new ?? '—'}</td>
            </tr>
        `).join('');
    }

    // ============================================================
    // SETTINGS
    // ============================================================

    function initSettings() {
        const cfg = getConfig();
        document.getElementById('cfg-supabase-url').value = cfg.supabaseUrl || DEFAULT_SUPA_URL;
        document.getElementById('cfg-supabase-key').value = cfg.supabaseKey || DEFAULT_SUPA_KEY;
    }

    function saveSettings() {
        const url = document.getElementById('cfg-supabase-url').value.trim();
        const key = document.getElementById('cfg-supabase-key').value.trim();

        saveConfig({ supabaseUrl: url, supabaseKey: key });

        if (initSupabase()) {
            toast('Подключение установлено', 'success');
            checkAuth();
        } else {
            toast('Не удалось подключиться', 'error');
        }
    }

    async function login() {
        if (!supabaseClient) {
            toast('Настройте Supabase сначала', 'warning');
            return;
        }

        const email = document.getElementById('auth-email').value.trim();
        const password = document.getElementById('auth-password').value.trim();

        if (!email || !password) {
            toast('Введите email и пароль', 'warning');
            return;
        }

        try {
            const { data, error } = await supabaseClient.auth.signInWithPassword({
                email,
                password,
            });

            if (error) throw error;
            currentUser = data.user;
            document.getElementById('user-name').textContent = email;
            document.getElementById('user-avatar').textContent = '✅';
            toast('Авторизация успешна', 'success');
        } catch (e) {
            toast(`Ошибка: ${e.message}`, 'error');
        }
    }

    async function loginDiscord() {
        if (!supabaseClient) {
            toast('Настройте Supabase сначала', 'warning');
            return;
        }

        try {
            const { error } = await supabaseClient.auth.signInWithOAuth({
                provider: 'discord',
            });
            if (error) throw error;
        } catch (e) {
            toast(`Ошибка: ${e.message}`, 'error');
        }
    }

    // ============================================================
    // UTILITIES
    // ============================================================

    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function truncate(text, maxLen) {
        if (!text || text.length <= maxLen) return text;
        return text.slice(0, maxLen) + '...';
    }

    // ============================================================
    // RULES FILTER
    // ============================================================

    function filterRules(query) {
        if (!query) {
            renderRulesTable(cachedRules);
            return;
        }
        query = query.toLowerCase();
        const filtered = cachedRules.filter(r =>
            r.rule_code.toLowerCase().includes(query) ||
            r.title.toLowerCase().includes(query) ||
            (r.category || '').toLowerCase().includes(query) ||
            (r.description || '').toLowerCase().includes(query) ||
            (r.keywords || []).some(k => k.toLowerCase().includes(query)) ||
            (r.aliases || []).some(a => a.toLowerCase().includes(query))
        );
        renderRulesTable(filtered);
    }

    // ============================================================
    // EVENT BINDINGS
    // ============================================================

    function bindEvents() {
        // Navigation
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                navigate(item.dataset.page);
            });
        });

        // Search
        document.getElementById('btn-search').addEventListener('click', () => {
            searchPlayer(document.getElementById('search-nickname').value);
        });
        document.getElementById('search-nickname').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') searchPlayer(e.target.value);
        });

        // Request Parse
        document.getElementById('btn-request-parse').addEventListener('click', () => {
            requestParse(document.getElementById('search-nickname').value);
        });

        // Quick analyze (от карточки игрока)
        document.getElementById('btn-quick-analyze').addEventListener('click', () => {
            if (currentPlayer) {
                document.getElementById('analysis-player').value = currentPlayer.nickname;
                navigate('analysis');
            }
        });

        // Analysis
        document.getElementById('btn-analyze').addEventListener('click', runAnalysis);
        document.getElementById('analysis-reason').addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && e.ctrlKey) runAnalysis();
        });
        document.getElementById('btn-load-player').addEventListener('click', async () => {
            const nick = document.getElementById('analysis-player').value.trim();
            if (nick) await searchPlayer(nick);
        });

        // Copy recommendation
        document.getElementById('btn-copy-recommendation').addEventListener('click', copyRecommendation);

        // Manual rule apply
        document.getElementById('btn-apply-manual-rule').addEventListener('click', () => {
            const ruleCode = document.getElementById('manual-rule-select').value;
            if (ruleCode) applyManualRule(ruleCode);
        });

        // Rules filter
        document.getElementById('rules-filter').addEventListener('input', (e) => {
            filterRules(e.target.value);
        });

        // Rule detail close
        document.getElementById('btn-close-rule-detail').addEventListener('click', () => {
            document.getElementById('rule-detail-card').style.display = 'none';
        });

        // Settings
        document.getElementById('btn-save-config').addEventListener('click', saveSettings);
        document.getElementById('btn-login').addEventListener('click', login);
        document.getElementById('btn-login-discord').addEventListener('click', loginDiscord);
    }

    // ============================================================
    // INIT
    // ============================================================

    function init() {
        console.log('[GAT] GTAW Admin Tool starting...');

        // Привязываем события
        bindEvents();

        // Загружаем настройки
        initSettings();

        // Инициализируем Supabase
        if (initSupabase()) {
            checkAuth();
            loadRulesData(); // предзагружаем правила
        }

        // Навигация по hash
        const hash = window.location.hash.replace('#', '');
        if (hash) navigate(hash);

        console.log('[GAT] Initialized');
    }

    // DOM Ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
