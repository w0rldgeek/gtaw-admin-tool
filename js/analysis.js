/**
 * ============================================================
 * GTAW Admin Tool — Analysis Engine
 * ============================================================
 *
 * Модуль сопоставления причин нарушений с правилами сервера.
 * Вся бизнес-логика анализа живёт здесь — не в Tampermonkey.
 *
 * Алгоритм:
 * 1. Нормализация текста причины
 * 2. Точное совпадение по rule_code / title
 * 3. Поиск по aliases
 * 4. Поиск по keywords
 * 5. Поиск по examples (fuzzy)
 * 6. Ранжирование по confidence score
 * 7. Подсчёт повторных нарушений
 * 8. Определение рекомендуемого наказания
 * 9. Генерация объяснения
 * ============================================================
 */

const AnalysisEngine = (() => {
    'use strict';

    // ============================================================
    // НОРМАЛИЗАЦИЯ ТЕКСТА
    // ============================================================

    /**
     * Нормализует текст причины для сопоставления.
     * @param {string} text - Исходный текст
     * @returns {string} - Нормализованный текст
     */
    function normalizeText(text) {
        if (!text) return '';
        return text
            .toLowerCase()
            .trim()
            // Удаляем лишние пробелы
            .replace(/\s+/g, ' ')
            // Удаляем спецсимволы, оставляем буквы, цифры, пробелы, дефис, точку, слеш
            .replace(/[^\wа-яёa-z0-9\s\-\.\/]/gi, '')
            .trim();
    }

    /**
     * Токенизирует текст в массив слов (без стоп-слов)
     */
    function tokenize(text) {
        const stopWords = new Set([
            'в', 'на', 'по', 'за', 'из', 'от', 'до', 'без', 'для', 'при', 'через',
            'и', 'или', 'но', 'а', 'не', 'ни', 'то', 'же', 'бы',
            'с', 'к', 'о', 'у', 'an', 'the', 'a', 'is', 'of', 'in', 'on', 'at',
            'был', 'была', 'было', 'были', 'есть', 'это', 'этот',
            'игрок', 'player', 'reason', 'причина',
        ]);

        return normalizeText(text)
            .split(/\s+/)
            .filter(w => w.length > 1 && !stopWords.has(w));
    }

    // ============================================================
    // АЛГОРИТМЫ СОПОСТАВЛЕНИЯ
    // ============================================================

    /**
     * Расстояние Левенштейна (для fuzzy-поиска)
     */
    function levenshteinDistance(a, b) {
        if (a.length === 0) return b.length;
        if (b.length === 0) return a.length;

        const matrix = Array.from({ length: b.length + 1 }, (_, i) =>
            Array.from({ length: a.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
        );

        for (let i = 1; i <= b.length; i++) {
            for (let j = 1; j <= a.length; j++) {
                const cost = a[j - 1] === b[i - 1] ? 0 : 1;
                matrix[i][j] = Math.min(
                    matrix[i - 1][j] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j - 1] + cost
                );
            }
        }

        return matrix[b.length][a.length];
    }

    /**
     * Нормализованное сходство строк (0..1)
     */
    function stringSimilarity(a, b) {
        if (!a || !b) return 0;
        a = normalizeText(a);
        b = normalizeText(b);
        if (a === b) return 1;

        const maxLen = Math.max(a.length, b.length);
        if (maxLen === 0) return 1;

        const dist = levenshteinDistance(a, b);
        return 1 - dist / maxLen;
    }

    /**
     * Коэффициент Жаккара для множеств токенов
     */
    function jaccardSimilarity(setA, setB) {
        if (setA.size === 0 && setB.size === 0) return 0;
        let intersection = 0;
        for (const item of setA) {
            if (setB.has(item)) intersection++;
        }
        return intersection / (setA.size + setB.size - intersection);
    }

    /**
     * Проверяет, содержит ли текст хотя бы одно из слов/фраз из массива.
     * Возвращает количество совпадений и лучшее совпадение.
     */
    function matchAgainstArray(normalizedText, candidates) {
        if (!candidates || candidates.length === 0) return { count: 0, best: null, score: 0 };

        let matchCount = 0;
        let bestScore = 0;
        let bestMatch = null;

        for (const candidate of candidates) {
            const normCandidate = normalizeText(candidate);
            if (!normCandidate) continue;

            // Точное вхождение подстроки
            if (normalizedText.includes(normCandidate)) {
                matchCount++;
                const score = normCandidate.length / normalizedText.length;
                if (score > bestScore) {
                    bestScore = Math.min(score * 1.2, 1); // бонус за точное вхождение
                    bestMatch = candidate;
                }
                continue;
            }

            // Fuzzy: если длинная фраза, сравниваем по токенам
            const candTokens = new Set(tokenize(candidate));
            const textTokens = new Set(tokenize(normalizedText));
            const jaccard = jaccardSimilarity(textTokens, candTokens);

            if (jaccard > 0.3) {
                matchCount++;
                if (jaccard > bestScore) {
                    bestScore = jaccard;
                    bestMatch = candidate;
                }
            }
        }

        return { count: matchCount, best: bestMatch, score: bestScore };
    }

    // ============================================================
    // ОСНОВНОЙ МАТЧИНГ
    // ============================================================

    /**
     * Сопоставляет причину с одним правилом. Возвращает confidence 0..1.
     */
    function matchReasonToRule(normalizedReason, reasonTokens, rule) {
        let confidence = 0;
        const reasons = [];

        const normTitle = normalizeText(rule.title);
        const normCode = normalizeText(rule.rule_code);

        // --- 1. Точное совпадение по rule_code ---
        if (normalizedReason.includes(normCode) || normalizedReason === normCode) {
            confidence = Math.max(confidence, 0.95);
            reasons.push(`Точное совпадение с кодом правила ${rule.rule_code}`);
        }

        // --- 2. Точное совпадение по title ---
        if (normalizedReason.includes(normTitle) || normalizedReason === normTitle) {
            confidence = Math.max(confidence, 0.92);
            reasons.push(`Совпадение с названием "${rule.title}"`);
        }

        // --- 3. Поиск по aliases ---
        if (rule.aliases && rule.aliases.length > 0) {
            const aliasMatch = matchAgainstArray(normalizedReason, rule.aliases);
            if (aliasMatch.count > 0) {
                const aliasScore = Math.min(0.85, 0.6 + aliasMatch.score * 0.3);
                if (aliasScore > confidence) {
                    confidence = aliasScore;
                    reasons.push(`Совпадение с алиасом "${aliasMatch.best}"`);
                }
            }
        }

        // --- 4. Поиск по keywords ---
        if (rule.keywords && rule.keywords.length > 0) {
            const kwMatch = matchAgainstArray(normalizedReason, rule.keywords);
            if (kwMatch.count > 0) {
                // Чем больше ключевых слов совпало, тем выше уверенность
                const kwScore = Math.min(0.80, 0.4 + (kwMatch.count / rule.keywords.length) * 0.4);
                if (kwScore > confidence) {
                    confidence = kwScore;
                    reasons.push(`Совпадение по ключевым словам (${kwMatch.count}/${rule.keywords.length})`);
                }
            }
        }

        // --- 5. Поиск по examples ---
        if (rule.examples && rule.examples.length > 0) {
            const exMatch = matchAgainstArray(normalizedReason, rule.examples);
            if (exMatch.count > 0) {
                const exScore = Math.min(0.75, 0.45 + exMatch.score * 0.3);
                if (exScore > confidence) {
                    confidence = exScore;
                    reasons.push(`Похоже на пример "${exMatch.best}"`);
                }
            }

            // Дополнительно: строковое сходство с каждым примером
            for (const example of rule.examples) {
                const sim = stringSimilarity(normalizedReason, example);
                if (sim > 0.6) {
                    const simScore = sim * 0.7;
                    if (simScore > confidence) {
                        confidence = simScore;
                        reasons.push(`Высокое сходство с примером "${example}" (${Math.round(sim * 100)}%)`);
                    }
                }
            }
        }

        // --- 6. Бонус за severity (серьёзные правила чуть более вероятны при неточных матчах) ---
        if (confidence > 0.3 && confidence < 0.7 && rule.severity >= 4) {
            confidence += 0.03;
        }

        return {
            rule,
            confidence: Math.round(confidence * 100) / 100,
            reasons,
        };
    }

    /**
     * Находит все подходящие правила для причины, отсортированные по confidence.
     * @param {string} reason - Причина нарушения (текст от администратора)
     * @param {Array} rules - Массив правил из базы данных
     * @returns {Array} - Массив {rule, confidence, reasons}, отсортированный по confidence desc
     */
    function findMatchingRules(reason, rules) {
        const normalizedReason = normalizeText(reason);
        const reasonTokens = new Set(tokenize(reason));

        if (!normalizedReason || !rules || rules.length === 0) {
            return [];
        }

        const results = rules
            .filter(r => r.is_active !== false) // Пропускаем неактивные
            .map(rule => matchReasonToRule(normalizedReason, reasonTokens, rule))
            .filter(r => r.confidence > 0.15) // Отсекаем совсем слабые
            .sort((a, b) => b.confidence - a.confidence);

        return results;
    }

    // ============================================================
    // ПОДСЧЁТ ПОВТОРНЫХ НАРУШЕНИЙ
    // ============================================================

    /**
     * Подсчитывает повторные нарушения по аналогичному правилу.
     *
     * @param {object} matchedRule - Найденное правило
     * @param {Array} playerPunishments - Все наказания игрока
     * @param {Array} allRules - Все правила (для перекрёстного анализа)
     * @returns {{ count: number, similar: Array }} - Количество повторов и список похожих
     */
    function countRepeats(matchedRule, playerPunishments, allRules) {
        if (!matchedRule || !playerPunishments || playerPunishments.length === 0) {
            return { count: 0, similar: [] };
        }

        const similar = [];

        for (const p of playerPunishments) {
            const reasonNorm = normalizeText(p.reason_raw || p.reason_normalized || '');
            if (!reasonNorm) continue;

            // Проверяем, относится ли это наказание к тому же правилу
            const match = matchReasonToRule(reasonNorm, new Set(tokenize(reasonNorm)), matchedRule);

            if (match.confidence >= 0.4) {
                similar.push({
                    ...p,
                    matchConfidence: match.confidence,
                    matchReasons: match.reasons,
                });
            }
        }

        // Сортируем по дате (новые сначала)
        similar.sort((a, b) => {
            const da = a.punishment_date ? new Date(a.punishment_date) : new Date(0);
            const db = b.punishment_date ? new Date(b.punishment_date) : new Date(0);
            return db - da;
        });

        return {
            count: similar.length,
            similar,
        };
    }

    // ============================================================
    // ОПРЕДЕЛЕНИЕ РЕКОМЕНДУЕМОГО НАКАЗАНИЯ
    // ============================================================

    /**
     * Определяет рекомендуемое наказание на основе правила и количества повторов.
     *
     * @param {object} rule - Правило
     * @param {number} repeatCount - Количество предыдущих аналогичных нарушений
     * @returns {{ term: string, minutes: number, category: string }}
     */
    function getRecommendedPunishment(rule, repeatCount) {
        if (!rule) {
            return { term: 'Не определено', minutes: 0, category: 'unknown' };
        }

        if (repeatCount === 0) {
            return {
                term: rule.base_punishment || 'Не указано',
                minutes: rule.base_minutes || 0,
                category: 'first',
            };
        } else if (repeatCount === 1) {
            return {
                term: rule.repeat_punishment || rule.base_punishment || 'Не указано',
                minutes: rule.repeat_minutes || rule.base_minutes || 0,
                category: 'repeat',
            };
        } else {
            return {
                term: rule.multiple_punishment || rule.repeat_punishment || rule.base_punishment || 'Не указано',
                minutes: rule.multiple_minutes || rule.repeat_minutes || rule.base_minutes || 0,
                category: 'multiple',
            };
        }
    }

    // ============================================================
    // ГЕНЕРАЦИЯ ОБЪЯСНЕНИЯ
    // ============================================================

    /**
     * Генерирует человекочитаемое объяснение результата анализа.
     */
    function generateExplanation(matchResult, repeatInfo, recommendation, originalReason) {
        const lines = [];

        // 1. Что анализировали
        lines.push(`Причина нарушения: "${originalReason}"`);
        lines.push('');

        // 2. Найденное правило
        if (matchResult && matchResult.rule) {
            const r = matchResult.rule;
            lines.push(`Сопоставлено с пунктом ${r.rule_code} "${r.title}"`);
            lines.push(`Уверенность: ${Math.round(matchResult.confidence * 100)}%`);

            if (matchResult.reasons.length > 0) {
                lines.push('Основания:');
                matchResult.reasons.forEach(reason => {
                    lines.push(`  - ${reason}`);
                });
            }
            lines.push('');
        }

        // 3. Повторность
        if (repeatInfo.count > 0) {
            lines.push(`Найдено ${repeatInfo.count} предыдущих наказаний по аналогичному нарушению:`);
            repeatInfo.similar.slice(0, 5).forEach(p => {
                const date = p.punishment_date ? new Date(p.punishment_date).toLocaleDateString('ru-RU') : '?';
                lines.push(`  - ${date}: "${p.reason_raw}" (${p.punishment_term_raw || '?'})`);
            });
            lines.push('');
        } else {
            lines.push('Предыдущих аналогичных нарушений не найдено (первое нарушение).');
            lines.push('');
        }

        // 4. Рекомендация
        lines.push(`Рекомендуемое наказание: ${recommendation.term}`);
        const categoryLabels = {
            first: 'Первое нарушение',
            repeat: 'Повторное нарушение',
            multiple: 'Многократное нарушение (3+)',
            unknown: 'Не определено',
        };
        lines.push(`Категория: ${categoryLabels[recommendation.category] || recommendation.category}`);

        return lines.join('\n');
    }

    // ============================================================
    // ГЛАВНАЯ ФУНКЦИЯ АНАЛИЗА
    // ============================================================

    /**
     * Полный анализ нарушения.
     *
     * @param {string} reason - Причина нарушения (текст)
     * @param {Array} playerPunishments - Все наказания игрока
     * @param {Array} rules - Все правила сервера
     * @returns {object} - Полный результат анализа
     */
    function analyze(reason, playerPunishments = [], rules = []) {
        // 1. Находим подходящие правила
        const matches = findMatchingRules(reason, rules);
        const bestMatch = matches[0] || null;
        const alternatives = matches.slice(1, 6); // топ-5 альтернатив

        // 2. Считаем повторы
        const repeatInfo = bestMatch
            ? countRepeats(bestMatch.rule, playerPunishments, rules)
            : { count: 0, similar: [] };

        // 3. Определяем рекомендуемое наказание
        const recommendation = bestMatch
            ? getRecommendedPunishment(bestMatch.rule, repeatInfo.count)
            : { term: 'Правило не определено', minutes: 0, category: 'unknown' };

        // 4. Генерируем объяснение
        const explanation = generateExplanation(bestMatch, repeatInfo, recommendation, reason);

        // 5. Формируем результат
        return {
            // Входные данные
            queriedReason: reason,
            queriedReasonNormalized: normalizeText(reason),

            // Найденное правило
            matchedRule: bestMatch ? bestMatch.rule : null,
            matchedRuleCode: bestMatch ? bestMatch.rule.rule_code : null,
            confidence: bestMatch ? bestMatch.confidence : 0,
            matchReasons: bestMatch ? bestMatch.reasons : [],

            // Повторность
            repeatCount: repeatInfo.count,
            similarPunishments: repeatInfo.similar,

            // Рекомендация
            recommendedPunishment: recommendation.term,
            recommendedMinutes: recommendation.minutes,
            recommendedCategory: recommendation.category,

            // Альтернативы
            alternatives: alternatives.map(a => ({
                rule: a.rule,
                ruleCode: a.rule.rule_code,
                title: a.rule.title,
                confidence: a.confidence,
                reasons: a.reasons,
            })),

            // Объяснение
            explanation,
        };
    }

    /**
     * Анализ с ручным выбором правила (override).
     */
    function analyzeWithManualRule(reason, playerPunishments, rules, manualRuleId) {
        const manualRule = rules.find(r => r.id === manualRuleId || r.rule_code === manualRuleId);
        if (!manualRule) {
            return analyze(reason, playerPunishments, rules);
        }

        const repeatInfo = countRepeats(manualRule, playerPunishments, rules);
        const recommendation = getRecommendedPunishment(manualRule, repeatInfo.count);
        const explanation = generateExplanation(
            { rule: manualRule, confidence: 1, reasons: ['Правило выбрано вручную администратором'] },
            repeatInfo,
            recommendation,
            reason
        );

        return {
            queriedReason: reason,
            queriedReasonNormalized: normalizeText(reason),
            matchedRule: manualRule,
            matchedRuleCode: manualRule.rule_code,
            confidence: 1,
            matchReasons: ['Ручной выбор администратора'],
            repeatCount: repeatInfo.count,
            similarPunishments: repeatInfo.similar,
            recommendedPunishment: recommendation.term,
            recommendedMinutes: recommendation.minutes,
            recommendedCategory: recommendation.category,
            alternatives: [],
            explanation,
            isManualOverride: true,
        };
    }

    // ============================================================
    // PUBLIC API
    // ============================================================

    return {
        analyze,
        analyzeWithManualRule,
        findMatchingRules,
        countRepeats,
        getRecommendedPunishment,
        normalizeText,
        stringSimilarity,
        // Для тестов
        _internal: {
            tokenize,
            matchAgainstArray,
            levenshteinDistance,
            jaccardSimilarity,
        },
    };
})();
