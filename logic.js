// Regras de negócio e helpers de data — sem dependência de DOM.

export const WEEKS_PER_MONTH = 52 / 12; // ≈ 4,33

export const defaultSettings = () => ({
    diasTrabalhoMes: 0,      // derivado de diasSemana (mantido por compatibilidade)
    diasSemana: [],          // dias da semana trabalhados (0 = domingo)
    dataInicio: null,        // "dia 0": quando o usuário começou (ou zerou os dados)
    metaLiquidaMensal: 0,
    mediaPagamentoKm: 0,
    mediaConsumoL: 0,
    mediaPrecoCombustivel: 0,
    plataformas: []
});

export const createDefaultData = () => ({ settings: defaultSettings(), history: [], goals: [] });

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
        && Array.isArray(s.diasSemana) && s.diasSemana.length > 0
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

    const weekdays = workWeekdays(s);
    const metaDia = dailyTarget(s, anchor);
    const metaCheia = scope === 'day' ? metaDia
        : scope === 'week' ? num(s.metaLiquidaMensal) / WEEKS_PER_MONTH
        : num(s.metaLiquidaMensal);

    // "Dia 0": os dias antes do início no app contam como meta batida, sem
    // lançar nada no histórico. Se o início cai no meio do período, a meta
    // fica proporcional aos dias de trabalho a partir dele.
    const inicio = typeof s.dataInicio === 'string' ? s.dataInicio : null;
    let meta = metaCheia, inicioParcial = null;
    const antesDoInicio = !!inicio && inicio > endKey;
    if (antesDoInicio) {
        meta = 0;
    } else if (inicio && inicio > startKey) {
        const total = countWorkDays(start, end, weekdays);
        if (total > 0) meta = metaCheia * countWorkDays(parseDateKey(inicio), end, weekdays) / total;
        inicioParcial = inicio;
    }

    const status = endKey < todayKey ? 'past' : startKey > todayKey ? 'future' : 'current';

    // Dias de trabalho restantes no período (incluindo hoje)
    let diasRestantes = 0;
    if (status !== 'past') {
        if (scope === 'day') {
            diasRestantes = 1;
        } else {
            const from = status === 'future' ? start : startOfDay(today);
            diasRestantes = Math.max(1, countWorkDays(from, end, weekdays));
        }
    }

    const faltaLiquido = meta - summary.net;
    const progress = meta > 0 ? Math.max(0, Math.min(1, summary.net / meta)) : 0;
    const base = { scope, status, meta, metaCheia, metaDia, summary, progress, diasRestantes, inicioParcial };

    if (antesDoInicio) {
        return { ...base, progress: 1, metaAlcancada: true, antesDoInicio: true, excedente: Math.max(0, summary.net) };
    }
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


// ── Metas com prazo (objetivos) ───────────────────────────────────────
export const ALL_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

export const workWeekdays = (s) => (Array.isArray(s?.diasSemana) && s.diasSemana.length ? s.diasSemana : ALL_WEEKDAYS);

/** Dias de trabalho no mês de `d`, conforme os dias da semana do perfil. */
export function workDaysInMonth(s, d = new Date()) {
    const { start, end } = getMonthRange(d);
    return countWorkDays(start, end, workWeekdays(s));
}

/** Meta líquida diária: meta mensal dividida pelos dias de trabalho do mês. */
export function dailyTarget(s, d = new Date()) {
    const dias = workDaysInMonth(s, d);
    return dias > 0 ? num(s.metaLiquidaMensal) / dias : 0;
}

/** Dias da semana de trabalho do perfil (ou uma sugestão para perfis antigos). */
export function defaultWorkWeekdays(s) {
    if (Array.isArray(s?.diasSemana) && s.diasSemana.length) return [...s.diasSemana];
    return legacyWorkWeekdays(s);
}

/** Converte o antigo "dias de trabalho no mês" em dias da semana. */
export function legacyWorkWeekdays(s) {
    const dias = num(s?.diasTrabalhoMes);
    if (dias >= 28) return [...ALL_WEEKDAYS];
    if (dias > 0 && dias <= 22) return [1, 2, 3, 4, 5];
    return [1, 2, 3, 4, 5, 6];
}

/** Conta os dias entre `from` e `to` (inclusive) que caem nos dias da semana escolhidos. */
export function countWorkDays(from, to, weekdays = ALL_WEEKDAYS) {
    const end = startOfDay(to);
    let n = 0;
    for (let d = startOfDay(from); d <= end; d = addDays(d, 1)) {
        if (weekdays.includes(d.getDay())) n++;
    }
    return n;
}

const goalWeekdaysOf = (g) => (Array.isArray(g.weekdays) && g.weekdays.length ? g.weekdays : ALL_WEEKDAYS);

/** Ordem automática: prazo mais próximo primeiro; prazo igual, menor valor primeiro. */
export function goalAutoCompare(a, b) {
    return a.deadline.localeCompare(b.deadline)
        || num(a.amount) - num(b.amount)
        || (a.createdAt || 0) - (b.createdAt || 0);
}

const hasPriority = (g) => Number.isFinite(g.priority);
export const isManualOrder = (goals, today = new Date()) => {
    const key = toDateKey(startOfDay(today));
    return goals.some(g => g.deadline >= key && hasPriority(g));
};

/**
 * Ordem em que o lucro preenche as metas. Metas com prazo encerrado vêm primeiro
 * (o dinheiro daquele período já foi delas); depois as em aberto, pela prioridade
 * escolhida pelo usuário ou, sem escolha, pela ordem automática.
 */
export function orderGoals(goals, today = new Date()) {
    const key = toDateKey(startOfDay(today));
    const past = goals.filter(g => g.deadline < key).sort(goalAutoCompare);
    const open = goals.filter(g => g.deadline >= key);
    if (isManualOrder(goals, today)) {
        const pr = (g) => (hasPriority(g) ? g.priority : Infinity);
        open.sort((a, b) => (pr(a) - pr(b)) || goalAutoCompare(a, b));
    } else {
        open.sort(goalAutoCompare);
    }
    return [...past, ...open];
}

/**
 * Distribui o lucro líquido de cada dia entre as metas, em cascata: a primeira
 * meta da ordem recebe o lucro dos dias do seu período até completar; o que
 * sobra fica para as próximas. Retorna Map(id → valor recebido).
 */
export function allocateGoals(order, history, s, skipKey = null) {
    const avail = new Map();
    history.forEach(d => { if (d.date !== skipKey) avail.set(d.date, dayNet(d, s)); });
    const keys = [...avail.keys()].sort();
    const out = new Map();
    for (const g of order) {
        const meta = num(g.amount);
        let got = 0;
        for (const k of keys) {
            if (k < g.startDate) continue;
            if (k > g.deadline || got >= meta) break;
            const a = avail.get(k);
            if (!a) continue;
            if (got + a <= meta) { got += a; avail.set(k, 0); }
            else { avail.set(k, a - (meta - got)); got = meta; }
        }
        out.set(g.id, got);
    }
    return out;
}

/**
 * Situação de uma meta líquida com data limite.
 * O valor diário é calculado sem considerar o que já entrou hoje, para que
 * o "por dia" fique estável ao longo do dia e "hojeFalta" diminua a cada lançamento.
 * `alloc` ({ net, netBefore }) traz o valor que a meta recebeu na cascata
 * (com e sem o dia de hoje); sem ele, a meta é calculada sozinha.
 */
export function goalProgress(goal, s, history, today = new Date(), alloc = null) {
    const t = startOfDay(today);
    const todayKey = toDateKey(t);
    const start = parseDateKey(goal.startDate);
    const end = parseDateKey(goal.deadline);
    const weekdays = goalWeekdaysOf(goal);
    const meta = num(goal.amount);

    const days = filterRange(history, goal.startDate, goal.deadline);
    const todayDay = days.find(d => d.date === todayKey);
    const net = alloc ? alloc.net : summarize(days, s).net;
    const falta = meta - net;
    const status = falta <= 0.004 ? 'done'
        : todayKey > goal.deadline ? 'expired'
        : todayKey < goal.startDate ? 'scheduled'
        : 'active';

    const res = {
        goal, status, meta, net,
        progress: meta > 0 ? Math.max(0, Math.min(1, net / meta)) : 0,
        falta: Math.max(0, falta),
        totalWorkDays: countWorkDays(start, end, weekdays),
        calendarDaysLeft: Math.max(0, Math.round((end - t) / 86400000) + 1)
    };
    if (status === 'done' || status === 'expired') return res;

    let diasRestantes, base, todayNet = 0, todayIsWork = false;
    if (status === 'scheduled') {
        diasRestantes = res.totalWorkDays;
        base = falta;
    } else {
        todayNet = alloc ? alloc.net - alloc.netBefore : (todayDay ? dayNet(todayDay, s) : 0);
        todayIsWork = weekdays.includes(t.getDay()) || (todayDay ? isWorkedDay(todayDay) : false);
        diasRestantes = countWorkDays(addDays(t, 1), end, weekdays) + (todayIsWork ? 1 : 0);
        base = todayIsWork ? falta + todayNet : falta;
    }
    diasRestantes = Math.max(1, diasRestantes);

    const porDia = Math.max(0, base) / diasRestantes;
    return {
        ...res,
        diasRestantes,
        porDia,
        todayIsWork,
        todayNet,
        hojeFalta: todayIsWork ? Math.max(0, porDia - todayNet) : 0,
        ...perKm(porDia, s)
    };
}

function perKm(porDia, s) {
    const custoKm = num(s.mediaConsumoL) > 0 ? num(s.mediaPrecoCombustivel) / num(s.mediaConsumoL) : 0;
    const lucroKm = num(s.mediaPagamentoKm) - custoKm;
    const kmPorDia = lucroKm > 0 ? porDia / lucroKm : 0;
    return { kmPorDia, brutoPorDia: lucroKm > 0 ? kmPorDia * num(s.mediaPagamentoKm) : 0 };
}

/**
 * Quanto é preciso fazer por dia (valor constante) para bater todas as metas
 * em aberto, respeitando a cascata e o prazo de cada uma. Busca binária sobre
 * uma simulação dia a dia a partir de hoje.
 */
function combinedPlan(order, s, history, t, before) {
    const tk = toDateKey(t);
    const todayDay = history.find(d => d.date === tk);
    const workedToday = !!todayDay && isWorkedDay(todayDay);
    const items = order
        .filter(g => g.deadline >= tk)
        .map(g => ({ g, wd: goalWeekdaysOf(g), rem: num(g.amount) - (before.get(g.id) || 0) }))
        .filter(x => x.rem > 0.004);
    if (!items.length) return null;

    const last = items.reduce((m, x) => (x.g.deadline > m ? x.g.deadline : m), tk);
    const covers = (x, k) => k >= x.g.startDate && k <= x.g.deadline;
    const days = [];
    for (let d = t, k = tk; k <= last; d = addDays(d, 1), k = toDateKey(d)) {
        const cover = items.filter(x => covers(x, k));
        if (cover.length && (cover.some(x => x.wd.includes(d.getDay())) || (k === tk && workedToday))) days.push({ k, cover });
    }
    // meta sem nenhum dia de trabalho restante: conta o último dia dela
    items.forEach(x => {
        if (!days.some(d => d.cover.includes(x))) {
            const k = x.g.deadline;
            if (!days.some(d => d.k === k)) days.push({ k, cover: items.filter(y => covers(y, k)) });
        }
    });
    days.sort((a, b) => a.k.localeCompare(b.k));

    const reaches = (R) => {
        const rem = new Map(items.map(x => [x, x.rem]));
        for (const day of days) {
            let e = R;
            for (const x of day.cover) {
                const r = rem.get(x);
                if (r <= 0) continue;
                const u = Math.min(e, r);
                rem.set(x, r - u);
                e -= u;
                if (e <= 0) break;
            }
        }
        return [...rem.values()].every(r => r <= 0.005);
    };

    let lo = 0, hi = items.reduce((a, x) => a + x.rem, 0);
    for (let i = 0; i < 50 && hi - lo > 0.001; i++) {
        const mid = (lo + hi) / 2;
        if (reaches(mid)) hi = mid; else lo = mid;
    }
    const porDia = hi;
    const todayIsWork = days[0]?.k === tk;
    const todayNet = todayDay ? dayNet(todayDay, s) : 0;
    return {
        porDia,
        count: items.length,
        diasTrabalho: days.length,
        lastDeadline: last,
        todayIsWork,
        todayNet,
        hojeFalta: todayIsWork ? Math.max(0, porDia - todayNet) : 0,
        ...perKm(porDia, s)
    };
}

/**
 * Avalia todas as metas juntas: o lucro é dividido em cascata pela ordem de
 * prioridade. Retorna os resultados nessa ordem e o plano combinado.
 */
export function evaluateGoals(goals, s, history, today = new Date()) {
    const t = startOfDay(today);
    const tk = toDateKey(t);
    const order = orderGoals(goals, t);
    const after = allocateGoals(order, history, s);
    const before = allocateGoals(order, history, s, tk);
    const results = order.map((g, i) => ({
        ...goalProgress(g, s, history, t, { net: after.get(g.id) || 0, netBefore: before.get(g.id) || 0 }),
        rank: i
    }));

    // Ritmo de hoje: o lucro de hoje cobre o "por dia" de cada meta, na ordem de prioridade
    const todayDay = history.find(d => d.date === tk);
    let left = todayDay ? dayNet(todayDay, s) : 0;
    results.forEach(r => { if (r.status !== 'active') left -= Math.max(0, (after.get(r.goal.id) || 0) - (before.get(r.goal.id) || 0)); });
    results.forEach(r => {
        if (r.status !== 'active' || !r.todayIsWork) return;
        const got = Math.max(0, Math.min(left, r.porDia));
        r.todayNet = got;
        r.hojeFalta = Math.max(0, r.porDia - got);
        left -= got;
    });

    return { results, combined: combinedPlan(order, s, history, t, before) };
}
