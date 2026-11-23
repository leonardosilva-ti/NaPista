// Regras de negócio e helpers de data — sem dependência de DOM.

export const WEEKS_PER_MONTH = 52 / 12; // ≈ 4,33

export const defaultSettings = () => ({
    diasTrabalhoMes: 0,
    metaLiquidaMensal: 0,
    mediaPagamentoKm: 0,
    mediaConsumoL: 0,
    mediaPrecoCombustivel: 0,
    plataformas: []
});

export const createDefaultData = () => ({ settings: defaultSettings(), history: [] });

export const num = (v) => {
    const n = typeof v === 'number' ? v : parseFloat(v);
    return Number.isFinite(n) ? n : 0;
};

// ── Datas (sempre no fuso local do aparelho) ──────────────────────────
export function toDateKey(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

export function parseDateKey(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
}

export function startOfDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d, n) {
    const r = startOfDay(d);
    r.setDate(r.getDate() + n);
    return r;
}

export function getWeekRange(d) {
    const start = startOfDay(d);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); // segunda-feira
    return { start, end: addDays(start, 6) };
}

export function getMonthRange(d) {
    return {
        start: new Date(d.getFullYear(), d.getMonth(), 1),
        end: new Date(d.getFullYear(), d.getMonth() + 1, 0)
    };
}

export function getPeriodRange(scope, d) {
    if (scope === 'week') return getWeekRange(d);
    if (scope === 'month') return getMonthRange(d);
    const day = startOfDay(d);
    return { start: day, end: day };
}

export function filterRange(history, startKey, endKey) {
    return history.filter(h => h.date >= startKey && h.date <= endKey);
}

// ── Cálculos por dia ──────────────────────────────────────────────────
export function isConfigured(s) {
    return !!s
        && num(s.diasTrabalhoMes) > 0
        && num(s.metaLiquidaMensal) > 0
        && num(s.mediaPagamentoKm) > 0
        && num(s.mediaConsumoL) > 0
        && num(s.mediaPrecoCombustivel) > 0
        && Array.isArray(s.plataformas) && s.plataformas.length > 0;
}

export function dayGross(day) {
    return Object.values(day.earnings || {}).reduce((acc, v) => acc + num(v), 0);
}

export function dayLiters(day, s) {
    const km = num(day.km);
    const consumo = num(day.consumoL) || num(s.mediaConsumoL);
    return km > 0 && consumo > 0 ? km / consumo : 0;
}

export function dayFuelCost(day, s) {
    const preco = num(day.precoL) || num(s.mediaPrecoCombustivel);
    return dayLiters(day, s) * preco;
}

export function dayExpenses(day) {
    if (Array.isArray(day.detailedExpenses)) {
        return day.detailedExpenses.reduce((acc, e) => acc + num(e.val), 0);
    }
    return num(day.expenses);
}

export function dayNet(day, s) {
    return dayGross(day) - dayFuelCost(day, s) - dayExpenses(day);
}

export function isWorkedDay(day) {
    return dayGross(day) > 0 || num(day.km) > 0;
}

// Resumo agregado de um conjunto de dias
export function summarize(days, s) {
    const r = {
        days: days.length, workedDays: 0,
        gross: 0, fuel: 0, expenses: 0, net: 0,
        km: 0, liters: 0,
        byPlatform: {}, expenseItems: []
    };

    days.forEach(day => {
        const gross = dayGross(day);
        r.gross += gross;
        r.fuel += dayFuelCost(day, s);
        r.expenses += dayExpenses(day);
        r.km += num(day.km);
        r.liters += dayLiters(day, s);
        if (isWorkedDay(day)) r.workedDays++;

        for (const [p, v] of Object.entries(day.earnings || {})) {
            r.byPlatform[p] = (r.byPlatform[p] || 0) + num(v);
        }

        (day.detailedExpenses || []).forEach(e => {
            r.expenseItems.push({ desc: e.desc, val: num(e.val), date: day.date });
        });
    });

    r.net = r.gross - r.fuel - r.expenses;
    r.avgConsumo = r.liters > 0 ? r.km / r.liters : num(s.mediaConsumoL);
    r.avgPreco = r.liters > 0 ? r.fuel / r.liters : num(s.mediaPrecoCombustivel);
    r.costPerKm = r.km > 0 ? r.fuel / r.km : (r.avgConsumo > 0 ? r.avgPreco / r.avgConsumo : 0);
    r.grossPerKm = r.km > 0 ? r.gross / r.km : 0;
    r.expenseItems.sort((a, b) => b.date.localeCompare(a.date));
    return r;
}

// ── Metas ─────────────────────────────────────────────────────────────
/**
 * Calcula a situação da meta para o período (dia/semana/mês) que contém `anchor`.
 * Retorna quanto falta (líquido e bruto), km estimados e sugestão diária.
 */
export function calculateTargets(scope, s, history, anchor, today = new Date()) {
    const { start, end } = getPeriodRange(scope, anchor);
    const startKey = toDateKey(start);
    const endKey = toDateKey(end);
    const todayKey = toDateKey(today);
    const days = filterRange(history, startKey, endKey);
    const summary = summarize(days, s);

    const custoKmBase = num(s.mediaPrecoCombustivel) / num(s.mediaConsumoL);
    const lucroKmBase = num(s.mediaPagamentoKm) - custoKmBase;
    if (!(lucroKmBase > 0)) {
        return {
            summary,
            error: 'O custo do combustível por km é maior ou igual ao que você recebe por km. Revise suas metas.'
        };
    }

    const metaDia = num(s.metaLiquidaMensal) / num(s.diasTrabalhoMes);
    const meta = scope === 'day' ? metaDia
        : scope === 'week' ? num(s.metaLiquidaMensal) / WEEKS_PER_MONTH
        : num(s.metaLiquidaMensal);

    const status = endKey < todayKey ? 'past' : startKey > todayKey ? 'future' : 'current';

    // Dias de trabalho restantes no período (incluindo hoje)
    let diasRestantes = 0;
    if (status !== 'past') {
        if (scope === 'day') {
            diasRestantes = 1;
        } else {
            const from = status === 'future' ? start : startOfDay(today);
            const calendarLeft = Math.round((end - from) / 86400000) + 1;
            const planned = scope === 'week'
                ? Math.max(1, Math.round(num(s.diasTrabalhoMes) / WEEKS_PER_MONTH))
                : num(s.diasTrabalhoMes);
            const workedBefore = days.filter(d => d.date < todayKey && isWorkedDay(d)).length;
            diasRestantes = Math.min(calendarLeft, Math.max(1, planned - workedBefore));
        }
    }

    const faltaLiquido = meta - summary.net;
    const progress = meta > 0 ? Math.max(0, Math.min(1, summary.net / meta)) : 0;
    const base = { scope, status, meta, metaDia, summary, progress, diasRestantes };

    if (faltaLiquido <= 0) {
        return { ...base, metaAlcancada: true, excedente: -faltaLiquido };
    }

    // Eficiência real do período (se houver dados), senão as médias do perfil
    let ganhoKm = summary.km > 0 && summary.gross > 0 ? summary.gross / summary.km : num(s.mediaPagamentoKm);
    const custoKm = summary.km > 0 ? summary.fuel / summary.km : custoKmBase;
    let lucroKm = ganhoKm - custoKm;
    if (!(lucroKm > 0)) {
        ganhoKm = num(s.mediaPagamentoKm);
        lucroKm = lucroKmBase;
    }

    const kmFaltante = faltaLiquido / lucroKm;
    const brutoFaltante = kmFaltante * ganhoKm;

    return {
        ...base,
        metaAlcancada: false,
        faltaLiquido,
        brutoFaltante,
        kmFaltante,
        brutoPorDia: diasRestantes > 0 ? brutoFaltante / diasRestantes : 0,
        kmPorDia: diasRestantes > 0 ? kmFaltante / diasRestantes : 0
    };
}
