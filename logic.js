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
    plataformas: [],
    metaVariavel: false,     // meta do dia muda conforme os dias anteriores do mês
    metaVarSobe: true,       // ...aumenta quando faltou
    metaVarDesce: true       // ...diminui quando passou
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
export function calculateTargets(scope, s, history, anchor, today = new Date(), goals = []) {
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
    // metas com prazo somadas à meta do dia aumentam a meta dos dias do período delas
    const extras = scope === 'day' ? goalDailyExtras(goals, s, history, startKey, endKey, today) : new Map();
    let metaExtra = 0;
    const metaExtraGoals = new Map();
    if (scope === 'day') {
        extras.forEach(list => list.forEach(({ goal, value }) => {
            metaExtra += value;
            metaExtraGoals.set(goal, (metaExtraGoals.get(goal) || 0) + value);
        }));
    } else {
        // semana/mês: a parte da meta que cai no período (valor × dias dela no período ÷ dias dela)
        (goals || []).filter(g => isDailyGoal(g) && g.startDate <= endKey && g.deadline >= startKey).forEach(g => {
            const lo = g.startDate > startKey ? g.startDate : startKey;
            const hi = g.deadline < endKey ? g.deadline : endKey;
            const value = goalDailyShare(g) * countWorkDays(parseDateKey(lo), parseDateKey(hi), goalWeekdaysOf(g));
            if (value < 0.005) return;
            metaExtra += value;
            metaExtraGoals.set(g, value);
        });
    }
    // dia de folga (fora dos dias de trabalho do perfil): sem meta; o que entrar é excedente
    const folga = scope === 'day' && !weekdays.includes(start.getDay());
    const metaBase = folga ? 0 : dailyTarget(s, anchor);
    // meta variável (e o que entrou nas folgas): só a meta do dia muda (semana e mês continuam com a meta cheia)
    const metaVar = scope === 'day' && !folga ? dayTarget(s, history, startKey, today, goals) - metaBase : 0;
    const metaDia = metaBase + metaVar + (scope === 'day' ? metaExtra : 0);
    let metaCheia = scope === 'day' ? metaDia
        : scope === 'week' ? num(s.metaLiquidaMensal) / WEEKS_PER_MONTH
        : num(s.metaLiquidaMensal);

    // "Dia 0": os dias antes do início no app contam como meta batida, sem
    // lançar nada no histórico. Se o usuário lançou algum desses dias, ele
    // conta normalmente. A meta do período fica proporcional aos dias que contam.
    const inicio = typeof s.dataInicio === 'string' ? s.dataInicio : null;
    let meta = metaCheia, inicioParcial = null, antesDoInicio = false;
    if (inicio && inicio > startKey) {
        const lancados = new Set(days.map(d => d.date));
        let total = 0, contam = 0, dispensados = 0;
        for (let d = start; d <= end; d = addDays(d, 1)) {
            const k = toDateKey(d);
            const trabalho = weekdays.includes(d.getDay());
            if (trabalho) total++;
            if (k >= inicio ? trabalho : lancados.has(k)) contam++;
            else if (trabalho && k < inicio) dispensados++;
        }
        if (contam === 0) {
            antesDoInicio = true;
            meta = 0;
        } else if (scope !== 'day' && total > 0) {
            meta = metaCheia * Math.min(contam, total) / total;
        }
        if (dispensados > 0 && !antesDoInicio) inicioParcial = inicio;
    }
    if (scope !== 'day' && !antesDoInicio) {
        meta += metaExtra;
        metaCheia += metaExtra;
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
    const base = {
        scope, status, meta, metaCheia, metaDia, summary, progress, diasRestantes, inicioParcial,
        metaExtra: antesDoInicio ? 0 : metaExtra,
        metaVar: antesDoInicio ? 0 : metaVar,
        folga: folga && !(metaDia > 0.004),
        metaExtraGoals: antesDoInicio ? [] : [...metaExtraGoals].map(([goal, value]) => ({ goal, value }))
    };

    if (antesDoInicio) {
        return { ...base, progress: 1, metaAlcancada: true, antesDoInicio: true, excedente: Math.max(0, summary.net) };
    }
    // Eficiência real do período (se houver dados), senão as médias do perfil
    let ganhoKm = summary.km > 0 && summary.gross > 0 ? summary.gross / summary.km : num(s.mediaPagamentoKm);
    const custoKm = summary.km > 0 ? summary.fuel / summary.km : custoKmBase;
    let lucroKm = ganhoKm - custoKm;
    if (!(lucroKm > 0)) {
        ganhoKm = num(s.mediaPagamentoKm);
        lucroKm = lucroKmBase;
    }

    if (faltaLiquido <= 0) {
        const excedente = -faltaLiquido;
        // meta em bruto: o faturamento do período menos o bruto equivalente ao que passou da meta
        const excedenteBruto = lucroKm > 0 ? Math.min(summary.gross, excedente / lucroKm * ganhoKm) : null;
        return {
            ...base, metaAlcancada: true, excedente,
            excedenteBruto,
            metaBruta: excedenteBruto == null ? null : summary.gross - excedenteBruto
        };
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

/** Meta variável ligada (e com pelo menos uma das opções). */
export const isVariableTarget = (s) => s?.metaVariavel === true && (s.metaVarSobe !== false || s.metaVarDesce !== false);

/**
 * Meta do dia `key` (sem as metas com prazo). Com a meta variável, o que faltou
 * ou passou nos dias anteriores do mês é dividido entre os dias de trabalho que
 * restam (incluindo o dia): sobe quando faltou e/ou desce quando passou,
 * conforme as opções. Dias futuros usam o valor de hoje; o que passar hoje já
 * diminui os próximos dias, o que ainda não foi lançado hoje não aumenta.
 * Com metas somadas à meta do dia (`goals`), o que passa da meta normal vai
 * primeiro para elas: só o que sobrar depois delas diminui os próximos dias.
 */
export function dayTarget(s, history, key, today = new Date(), goals = []) {
    const daily = orderGoals(goals || [], today).filter(isDailyGoal);
    const plan = targetPlan(s, history, daily, today);
    return weekdayIsWork(s, key) ? plan.target(key) : plan.raw(key);
}

const weekdayIsWork = (s, key) => workWeekdays(s).includes(parseDateKey(key).getDay());
const monthKeyOf = (key) => key.slice(0, 8) + '01';
const nextMonthKey = (ms) => {
    const d = parseDateKey(ms);
    return toDateKey(new Date(d.getFullYear(), d.getMonth() + 1, 1));
};

/**
 * Meta normal de cada dia (meta variável e folgas), mês a mês, junto com o que
 * as metas somadas à meta do dia (`dailyGoals`, na ordem da cascata) levam de
 * cada dia: primeiro a meta normal; o que passar dela vai para essas metas até
 * completarem, e só o resto conta como excedente para os próximos dias.
 * Folga não tem meta normal: tudo o que entrar vai primeiro para essas metas.
 */
function targetPlan(s, history, dailyGoals, today) {
    const tk = toDateKey(startOfDay(today));
    const weekdays = workWeekdays(s);
    const variable = isVariableTarget(s);
    const nets = new Map(history.map(h => [h.date, dayNet(h, s)]));
    const rem = new Map(dailyGoals.map(g => [g.id, num(g.amount)]));
    const targets = new Map(), raws = new Map(), ran = new Set();
    const firstGoal = dailyGoals.reduce((m, g) => (!m || g.startDate < m ? g.startDate : m), null);
    let cursor = firstGoal ? monthKeyOf(firstGoal) : null;

    const take = (k, extra) => {
        let left = extra;
        for (const g of dailyGoals) {
            if (left <= 0) break;
            if (k < g.startDate || k > g.deadline) continue;
            const u = Math.min(left, rem.get(g.id));
            if (!(u > 0)) continue;
            rem.set(g.id, rem.get(g.id) - u);
            left -= u;
        }
        return extra - left;
    };

    const runMonth = (ms) => {
        const d0 = parseDateKey(ms);
        const end = getMonthRange(d0).end;
        const me = toDateKey(end);
        const base = dailyTarget(s, d0);
        const inicio = typeof s.dataInicio === 'string' && s.dataInicio > ms ? s.dataInicio : ms;
        const clamp = (v) => {
            if (!variable || s.metaVarSobe === false) v = Math.min(base, v);
            if (variable && s.metaVarDesce === false) v = Math.max(base, v);
            return Math.max(0, v);
        };
        let cum = 0, rawToday = null, future = null;
        for (let d = d0, k = ms; k <= me; d = addDays(d, 1), k = toDateKey(d)) {
            const work = weekdays.includes(d.getDay());
            const raw = base - cum / Math.max(1, countWorkDays(d, end, weekdays));
            if (k === tk) rawToday = raw;
            let v;
            if (!(base > 0) || ms > tk || k < inicio) v = base;
            else if (k <= tk) v = clamp(raw);
            else v = future ??= clamp(Math.min(rawToday ?? raw, raw));
            raws.set(k, v);
            targets.set(k, work ? v : 0);
            const net = nets.get(k) ?? 0;
            const t = net > 0 ? take(k, Math.max(0, net - (work ? v : 0))) : 0;
            if (k < inicio) continue;
            if (variable || !work) cum += net - t;
            if (variable && work) cum -= base;
        }
    };

    const ensure = (key) => {
        const m = monthKeyOf(key);
        if (ran.has(m)) return;
        if (!cursor || m < cursor) { runMonth(m); ran.add(m); return; }
        while (cursor <= m) {
            if (!ran.has(cursor)) { runMonth(cursor); ran.add(cursor); }
            cursor = nextMonthKey(cursor);
        }
    };

    return {
        target: (key) => { ensure(key); return targets.get(key); },
        raw: (key) => { ensure(key); return raws.get(key); }
    };
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

/** Meta com prazo que soma à meta do dia (a chave "Somar à meta do dia"). */
export const isDailyGoal = (g) => g?.addToDaily === true;

/** Quanto a meta acrescenta a cada dia de trabalho dela: valor ÷ dias de trabalho do período. */
export function goalDailyShare(g) {
    const n = countWorkDays(parseDateKey(g.startDate), parseDateKey(g.deadline), goalWeekdaysOf(g));
    return n > 0 ? num(g.amount) / n : 0;
}

/**
 * Acréscimo de cada dia entre `fromKey` e `toKey` pelas metas somadas à meta do
 * dia: Map(data → [{ goal, value }]). Cada dia de trabalho da meta recebe o que
 * faltava no começo do dia dividido pelos dias de trabalho que restam (incluindo
 * ele): o que passa da meta do dia vai para a meta e diminui os próximos dias.
 */
export function goalDailyExtras(goals, s, history, fromKey, toKey, today = new Date()) {
    const out = new Map();
    const daily = (goals || []).filter(g => isDailyGoal(g) && g.startDate <= toKey && g.deadline >= fromKey);
    if (!daily.length) return out;
    const alloc = allocateGoals(orderGoals(goals, today), history, s, null, today);
    for (const g of daily) {
        const wd = goalWeekdaysOf(g);
        const trace = alloc.trace.get(g.id) || [];
        const meta = num(g.amount);
        const tk = toDateKey(startOfDay(today));
        // dias futuros usam o valor de hoje: começa de hoje mesmo que o pedido seja depois
        const from = fromKey > tk ? tk : fromKey;
        const lo = g.startDate > from ? g.startDate : from;
        const hi = g.deadline < toKey ? g.deadline : toKey;
        const end = parseDateKey(g.deadline);
        let t = 0, got = 0, planned = null, todayValue = null;
        for (let d = parseDateKey(lo), k = lo; k <= hi; d = addDays(d, 1), k = toDateKey(d)) {
            while (t < trace.length && trace[t][0] < k) got = trace[t++][1];
            if (!wd.includes(d.getDay())) continue;
            let value = planned ?? Math.max(0, meta - got) / Math.max(1, countWorkDays(d, end, wd));
            if (k === tk) todayValue = value;
            if (k > tk && planned === null) {
                // dias futuros: valor igual em todos. O que passou da meta hoje já
                // diminui; o que ainda não foi lançado hoje não aumenta.
                if (todayValue !== null) value = Math.min(value, todayValue);
                planned = value;
            }
            if (k < fromKey || value < 0.005) continue;
            if (!out.has(k)) out.set(k, []);
            out.get(k).push({ goal: g, value });
        }
    }
    return out;
}

/** Acréscimo total de um dia pelas metas somadas à meta do dia. */
export const goalDailyExtra = (goals, s, history, key, today = new Date()) =>
    (goalDailyExtras(goals, s, history, key, key, today).get(key) || []).reduce((a, x) => a + x.value, 0);

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
 * sobra fica para as próximas. Retorna Map(id → líquido recebido); o
 * faturamento bruto correspondente (proporcional ao líquido usado de cada
 * dia) fica em `.gross`, Map(id → bruto).
 */
export function allocateGoals(order, history, s, skipKey = null, today = new Date()) {
    const avail = new Map();
    const availGross = new Map();
    const hist = skipKey ? history.filter(d => d.date !== skipKey) : history;
    // meta normal de cada dia, já descontando o que as metas somadas levaram antes
    const plan = targetPlan(s, hist, order.filter(isDailyGoal), today);
    hist.forEach(d => {
        avail.set(d.date, dayNet(d, s));
        availGross.set(d.date, dayGross(d));
    });
    const keys = [...avail.keys()].sort();
    const out = new Map();
    out.gross = new Map();
    out.trace = new Map(); // id → [[data, total recebido até esse dia]]
    for (const g of order) {
        const meta = num(g.amount);
        const daily = isDailyGoal(g);
        const trace = [];
        let got = 0, gross = 0;
        for (const k of keys) {
            if (k < g.startDate) continue;
            if (k > g.deadline || got >= meta) break;
            const total = avail.get(k);
            // somada à meta do dia: só o que passa da meta normal do dia conta para ela
            const reserve = daily && total > 0 ? Math.min(total, plan.target(k)) : 0;
            const a = total - reserve;
            if (daily && !(a > 0)) continue;
            if (!a && !availGross.get(k)) continue;
            if (got + a <= meta) {
                got += a;
                const part = reserve > 0 ? availGross.get(k) * (a / total) : availGross.get(k);
                gross += part;
                avail.set(k, reserve);
                availGross.set(k, availGross.get(k) - part);
            } else {
                const used = meta - got;
                const part = availGross.get(k) * (used / (reserve > 0 ? total : a));
                avail.set(k, total - used);
                availGross.set(k, availGross.get(k) - part);
                gross += part;
                got = meta;
            }
            trace.push([k, got]);
        }
        out.set(g.id, got);
        out.trace.set(g.id, trace);
        out.gross.set(g.id, gross);
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
    const sum = alloc ? null : summarize(days, s);
    const net = alloc ? alloc.net : sum.net;
    const gross = alloc ? alloc.gross : sum.gross;
    const falta = meta - net;
    const status = falta <= 0.004 ? 'done'
        : todayKey > goal.deadline ? 'expired'
        : todayKey < goal.startDate ? 'scheduled'
        : 'active';

    const res = {
        goal, status, meta, net, gross,
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
    const after = allocateGoals(order, history, s, null, t);
    const before = allocateGoals(order, history, s, tk, t);
    const results = order.map((g, i) => ({
        ...goalProgress(g, s, history, t, { net: after.get(g.id) || 0, gross: after.gross.get(g.id) || 0, netBefore: before.get(g.id) || 0 }),
        rank: i
    }));

    // Ritmo de hoje: o lucro de hoje cobre o "por dia" de cada meta, na ordem de prioridade
    const todayDay = history.find(d => d.date === tk);
    let left = todayDay ? dayNet(todayDay, s) : 0;
    results.forEach(r => { if (r.status !== 'active') left -= Math.max(0, (after.get(r.goal.id) || 0) - (before.get(r.goal.id) || 0)); });
    results.forEach(r => {
        if (r.status !== 'active' || !r.todayIsWork) return;
        // somada à meta do dia: já recebeu na cascata só o que passou da meta normal
        if (isDailyGoal(r.goal)) { left -= Math.max(0, r.todayNet); return; }
        const got = Math.max(0, Math.min(left, r.porDia));
        r.todayNet = got;
        r.hojeFalta = Math.max(0, r.porDia - got);
        left -= got;
    });

    // as somadas à meta do dia já estão na meta do dia: ficam fora do "para bater todas"
    return { results, combined: combinedPlan(order.filter(g => !isDailyGoal(g)), s, history, t, before) };
}
