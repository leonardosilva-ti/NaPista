// Gestão na Pista: regras de finanças pessoais (contas, lançamentos e cartões).
// Sem dependência de DOM. Datas sempre como "AAAA-MM-DD" no fuso do aparelho.
import { num, toDateKey, parseDateKey, dayNet, dayGross } from './logic.js?v=2.6.0';

export const WALLET_ID = 'carteira';
export const APPS_CATEGORY_ID = 'r_apps';
const SYSTEM_CATEGORIES = new Set([APPS_CATEGORY_ID, 'd_outros', 'r_outros']);

export const ACCOUNT_KINDS = {
    dinheiro: 'Dinheiro',
    corrente: 'Conta corrente',
    digital: 'Conta digital',
    poupanca: 'Poupança',
    investimento: 'Investimento',
    outro: 'Outro'
};

export const CARD_COLORS = ['#8b5cf6', '#ec4899', '#f97316', '#0ea5e9', '#10b981', '#eab308', '#ef4444', '#64748b'];
export const CATEGORY_COLORS = ['#f59e0b', '#84cc16', '#a78bfa', '#60a5fa', '#fb7185', '#f97316', '#22d3ee', '#34d399', '#818cf8', '#f472b6', '#e879f9', '#94a3b8'];

const EXPENSE_CATEGORIES = [
    ['d_alimentacao', 'Alimentação', '#f59e0b'],
    ['d_mercado', 'Mercado', '#84cc16'],
    ['d_moradia', 'Moradia e aluguel', '#a78bfa'],
    ['d_contas', 'Contas da casa', '#60a5fa'],
    ['d_combustivel', 'Combustível', '#fb7185'],
    ['d_veiculo', 'Veículo e manutenção', '#f97316'],
    ['d_transporte', 'Transporte', '#22d3ee'],
    ['d_saude', 'Saúde', '#34d399'],
    ['d_educacao', 'Educação', '#818cf8'],
    ['d_lazer', 'Lazer', '#f472b6'],
    ['d_assinaturas', 'Assinaturas e streamings', '#e879f9'],
    ['d_compras', 'Compras', '#eab308'],
    ['d_impostos', 'Impostos e taxas', '#94a3b8'],
    ['d_outros', 'Outros', '#64748b']
];

const INCOME_CATEGORIES = [
    [APPS_CATEGORY_ID, 'Ganhos nos apps', '#10b981'],
    ['r_salario', 'Salário', '#60a5fa'],
    ['r_extra', 'Renda extra', '#a78bfa'],
    ['r_vendas', 'Vendas', '#f59e0b'],
    ['r_rendimentos', 'Rendimentos', '#22d3ee'],
    ['r_reembolso', 'Reembolso', '#84cc16'],
    ['r_presente', 'Presentes', '#f472b6'],
    ['r_outros', 'Outros', '#64748b']
];

export const defaultCategories = () => [
    ...EXPENSE_CATEGORIES.map(([id, name, color]) => ({ id, name, color, type: 'expense' })),
    ...INCOME_CATEGORIES.map(([id, name, color]) => ({ id, name, color, type: 'income' }))
];

export const isSystemCategory = (id) => SYSTEM_CATEGORIES.has(id);
export const fallbackCategoryId = (type) => (type === 'income' ? 'r_outros' : 'd_outros');

export const defaultFinance = () => ({
    setupDone: false,
    // mode: 'net' (líquido) ou 'gross' (bruto); since: a partir de quando os ganhos entram (null = todos)
    integration: { mode: null, accountId: WALLET_ID, since: null },
    accounts: [{ id: WALLET_ID, name: 'Carteira', kind: 'dinheiro', initial: 0 }],
    categories: defaultCategories(),
    cards: [],
    entries: [],
    payments: [],   // pagamentos de fatura: { id, cardId, ym, amount, date, accountId }
    transfers: []   // transferências entre contas: { id, fromId, toId, amount, date, desc }
});

// ── Datas ─────────────────────────────────────────────────────────────
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const pad2 = (n) => String(n).padStart(2, '0');
const daysInMonth = (y, m1) => new Date(y, m1, 0).getDate(); // m1 = 1..12

export const ymOf = (key) => key.slice(0, 7);

export function ymShift(ym, n) {
    const [y, m] = ym.split('-').map(Number);
    const d = new Date(y, m - 1 + n, 1);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

/** Dia `day` do mês `ym`, limitado ao último dia do mês (ex.: 31 em fevereiro → 28/29). */
export function dayIn(ym, day) {
    const [y, m] = ym.split('-').map(Number);
    return `${ym}-${pad2(Math.min(Math.max(1, day), daysInMonth(y, m)))}`;
}

export const addMonthsKey = (key, n) => dayIn(ymShift(ymOf(key), n), Number(key.slice(8)));

export function addDaysKey(key, n) {
    const d = parseDateKey(key);
    d.setDate(d.getDate() + n);
    return toDateKey(d);
}

export const daysBetween = (a, b) => Math.round((parseDateKey(b) - parseDateKey(a)) / 86400000);

export const monthRange = (ym) => ({ start: `${ym}-01`, end: dayIn(ym, 31) });

// ── Normalização ──────────────────────────────────────────────────────
const clampDay = (v, def) => {
    const n = Math.round(num(v));
    return n >= 1 && n <= 31 ? n : def;
};

function normalizeRec(rec) {
    const kind = ['once', 'fixed', 'repeat', 'installment'].includes(rec?.kind) ? rec.kind : 'once';
    const out = { kind };
    if (kind === 'repeat' || kind === 'installment') out.count = Math.min(420, Math.max(1, Math.round(num(rec.count)) || 1));
    if (kind === 'repeat' || kind === 'fixed') out.freq = ['weekly', 'monthly', 'yearly'].includes(rec.freq) ? rec.freq : 'monthly';
    return out;
}

export function normalizeFinance(raw) {
    const def = defaultFinance();
    const f = raw && typeof raw === 'object' ? raw : {};

    const accounts = (Array.isArray(f.accounts) ? f.accounts : [])
        .filter(a => a && typeof a.id === 'string' && typeof a.name === 'string' && a.name.trim())
        .map(a => ({ id: a.id, name: a.name.trim(), kind: ACCOUNT_KINDS[a.kind] ? a.kind : 'outro', initial: num(a.initial) }));
    if (!accounts.some(a => a.id === WALLET_ID)) accounts.unshift(def.accounts[0]);
    const accIds = new Set(accounts.map(a => a.id));

    let categories = (Array.isArray(f.categories) ? f.categories : def.categories)
        .filter(c => c && typeof c.id === 'string' && typeof c.name === 'string' && (c.type === 'expense' || c.type === 'income'))
        .map(c => ({ id: c.id, name: c.name, color: typeof c.color === 'string' ? c.color : '#64748b', type: c.type }));
    // categorias do sistema sempre existem (ganhos dos apps e "Outros" para onde vão as excluídas)
    def.categories.filter(c => SYSTEM_CATEGORIES.has(c.id) && !categories.some(x => x.id === c.id)).forEach(c => categories.push(c));

    const cards = (Array.isArray(f.cards) ? f.cards : [])
        .filter(c => c && typeof c.id === 'string' && typeof c.name === 'string')
        .map(c => ({
            id: c.id,
            name: c.name,
            limit: num(c.limit),
            closingDay: clampDay(c.closingDay, 1),
            dueDay: clampDay(c.dueDay, 10),
            accountId: accIds.has(c.accountId) ? c.accountId : WALLET_ID,
            color: typeof c.color === 'string' ? c.color : CARD_COLORS[0],
            // faturas que venceram antes do cadastro contam como já pagas
            since: DATE_RE.test(c.since || '') ? c.since : toDateKey(new Date())
        }));
    const cardIds = new Set(cards.map(c => c.id));

    const entries = (Array.isArray(f.entries) ? f.entries : [])
        .filter(e => e && typeof e.id === 'string' && num(e.amount) > 0 && DATE_RE.test(e.date)
            && (e.type === 'expense' || e.type === 'income') && (!e.cardId || cardIds.has(e.cardId)))
        .map(e => {
            const out = {
                id: e.id,
                type: e.cardId ? 'expense' : e.type,
                desc: String(e.desc || ''),
                amount: num(e.amount),
                date: e.date,
                categoryId: typeof e.categoryId === 'string' ? e.categoryId : fallbackCategoryId(e.type),
                rec: normalizeRec(e.rec),
                createdAt: num(e.createdAt) || 0
            };
            if (e.cardId) out.cardId = e.cardId;
            else out.accountId = accIds.has(e.accountId) ? e.accountId : WALLET_ID;
            if (Number.isInteger(e.endIdx) && e.endIdx >= 0) out.endIdx = e.endIdx;
            if (e.overrides && typeof e.overrides === 'object' && Object.keys(e.overrides).length) out.overrides = e.overrides;
            return out;
        });

    const payments = (Array.isArray(f.payments) ? f.payments : [])
        .filter(p => p && typeof p.id === 'string' && cardIds.has(p.cardId) && /^\d{4}-\d{2}$/.test(p.ym || '')
            && num(p.amount) > 0 && DATE_RE.test(p.date))
        .map(p => ({ id: p.id, cardId: p.cardId, ym: p.ym, amount: num(p.amount), date: p.date, accountId: accIds.has(p.accountId) ? p.accountId : WALLET_ID }));

    const transfers = (Array.isArray(f.transfers) ? f.transfers : [])
        .filter(t => t && typeof t.id === 'string' && accIds.has(t.fromId) && accIds.has(t.toId) && t.fromId !== t.toId
            && num(t.amount) > 0 && DATE_RE.test(t.date))
        .map(t => ({ id: t.id, fromId: t.fromId, toId: t.toId, amount: num(t.amount), date: t.date, desc: String(t.desc || '') }));

    const integ = f.integration || {};
    const mode = integ.mode === 'net' || integ.mode === 'gross' ? integ.mode : null;
    return {
        setupDone: !!f.setupDone && !!mode,
        integration: {
            mode,
            accountId: accIds.has(integ.accountId) ? integ.accountId : WALLET_ID,
            since: DATE_RE.test(integ.since || '') ? integ.since : null
        },
        accounts, categories, cards, entries, payments, transfers
    };
}

// ── Lançamentos (séries) ──────────────────────────────────────────────
/** Quantas ocorrências a série tem (Infinity para fixos sem fim). */
export function seriesLength(e) {
    const k = e.rec?.kind || 'once';
    let n = k === 'once' ? 1 : k === 'fixed' ? Infinity : Math.max(1, e.rec.count || 1);
    if (Number.isInteger(e.endIdx)) n = Math.min(n, e.endIdx + 1);
    return n;
}

export function occurrenceDate(e, i) {
    if (i === 0) return e.date;
    const freq = e.rec?.kind === 'installment' ? 'monthly' : (e.rec?.freq || 'monthly');
    if (freq === 'weekly') return addDaysKey(e.date, 7 * i);
    if (freq === 'yearly') return addMonthsKey(e.date, 12 * i);
    return addMonthsKey(e.date, i);
}

/** Valor de cada parcela; os centavos que sobram da divisão ficam na 1ª. */
export function installmentValue(total, count, i) {
    const cents = Math.round(num(total) * 100);
    const n = Math.max(1, count);
    const base = Math.floor(cents / n);
    return (i === 0 ? cents - base * (n - 1) : base) / 100;
}

/** Ocorrências de um lançamento entre duas datas (inclusive). */
export function expandEntry(e, fromKey, toKey) {
    const out = [];
    const n = seriesLength(e);
    const kind = e.rec?.kind || 'once';
    for (let i = 0; i < n; i++) {
        const date = occurrenceDate(e, i);
        if (date > toKey) break;
        if (date < fromKey) continue;
        const ov = e.overrides?.[i];
        if (ov?.deleted) continue;
        const base = kind === 'installment' ? installmentValue(e.amount, e.rec.count, i) : num(e.amount);
        out.push({
            id: `${e.id}:${i}`,
            entry: e,
            idx: i,
            date,
            amount: ov?.amount ?? base,
            type: e.type,
            desc: ov?.desc ?? e.desc,
            categoryId: ov?.categoryId ?? e.categoryId,
            accountId: e.cardId ? null : (ov?.accountId ?? e.accountId),
            cardId: e.cardId || null,
            kind,
            n: i + 1,
            total: kind === 'installment' || kind === 'repeat' ? e.rec.count : null,
            edited: !!ov
        });
    }
    return out;
}

/**
 * Ganhos lançados no Na Pista viram lançamentos da gestão (não são copiados:
 * alterar o dia no Na Pista já muda aqui). Líquido = bruto − combustível
 * estimado − gastos do dia; bruto = o que os apps pagaram.
 */
export function napistaOccurrences(data, fromKey, toKey) {
    const fin = data.finance;
    if (!fin?.setupDone) return [];
    const { mode, accountId, since } = fin.integration;
    const lo = since && since > fromKey ? since : fromKey;
    const out = [];
    for (const d of data.history) {
        if (d.date < lo || d.date > toKey) continue;
        const v = mode === 'gross' ? dayGross(d) : dayNet(d, data.settings);
        if (Math.abs(v) < 0.005) continue;
        out.push({
            id: `np:${d.date}`,
            virtual: true,
            date: d.date,
            amount: Math.round(Math.abs(v) * 100) / 100,
            type: v > 0 ? 'income' : 'expense',
            desc: v > 0 ? 'Ganhos nos apps' : 'Custos do dia nos apps',
            apps: Object.keys(d.earnings || {}).filter(k => num(d.earnings[k]) > 0),
            categoryId: v > 0 ? APPS_CATEGORY_ID : 'd_combustivel',
            accountId,
            cardId: null,
            kind: 'once'
        });
    }
    return out;
}

/** Todas as ocorrências (contas, cartões e Na Pista) no intervalo, em ordem de data. */
export function occurrences(data, fromKey, toKey) {
    const list = [];
    data.finance.entries.forEach(e => list.push(...expandEntry(e, fromKey, toKey)));
    list.push(...napistaOccurrences(data, fromKey, toKey));
    return list.sort((a, b) => a.date.localeCompare(b.date) || (a.type === b.type ? 0 : a.type === 'income' ? -1 : 1));
}

// ── Cartões de crédito ───────────────────────────────────────────────
/**
 * A fatura é identificada pelo mês de vencimento ("AAAA-MM"). Ela fecha no dia
 * de fechamento do mesmo mês (se o fechamento vem antes do vencimento) ou do
 * mês anterior. Compras feitas no dia do fechamento já vão para a próxima.
 */
export function invoiceDates(card, ym) {
    const due = dayIn(ym, card.dueDay);
    const closing = dayIn(card.closingDay < card.dueDay ? ym : ymShift(ym, -1), card.closingDay);
    return { closing, due };
}

export function invoiceFor(card, dateKey) {
    const ym0 = ymOf(dateKey);
    for (let k = -1; k <= 2; k++) {
        const ym = ymShift(ym0, k);
        if (dateKey < invoiceDates(card, ym).closing) return ym;
    }
    return ymShift(ym0, 3);
}

const cardEntries = (data, cardId) => data.finance.entries.filter(e => e.cardId === cardId);

/** Quanto já foi pago de uma fatura. */
export const paidAmount = (data, cardId, ym) => data.finance.payments
    .filter(p => p.cardId === cardId && p.ym === ym).reduce((a, p) => a + p.amount, 0);

/** Fatura que venceu antes de o cartão ser cadastrado no app: considerada paga. */
export const isSettled = (card, ym) => invoiceDates(card, ym).due < card.since;

/**
 * Situação da fatura:
 * open (recebendo compras), closed (fechada, aguardando pagamento),
 * overdue (vencida sem pagamento completo), paid (paga), empty (sem gastos),
 * settled (anterior ao cadastro do cartão).
 */
export function invoiceState(data, card, ym, todayKey, total) {
    const { closing, due } = invoiceDates(card, ym);
    const paid = paidAmount(data, card.id, ym);
    const remaining = Math.max(0, Math.round((total - paid) * 100) / 100);
    let status;
    if (isSettled(card, ym)) status = 'settled';
    else if (total <= 0.005 && paid <= 0.005) status = todayKey >= closing ? 'empty' : 'open';
    else if (remaining <= 0.005) status = 'paid';
    else if (todayKey >= due) status = 'overdue';
    else if (todayKey >= closing) status = 'closed';
    else status = 'open';
    return { status, paid, remaining: status === 'settled' ? 0 : remaining };
}

/** Compras de uma fatura, com o que já foi pago. */
export function cardInvoice(data, card, ym, todayKey) {
    const { closing, due } = invoiceDates(card, ym);
    const from = invoiceDates(card, ymShift(ym, -1)).closing;
    const to = addDaysKey(closing, -1);
    const items = [];
    cardEntries(data, card.id).forEach(e => items.push(...expandEntry(e, from, to)));
    items.sort((a, b) => a.date.localeCompare(b.date));
    const total = items.reduce((a, o) => a + o.amount, 0);
    const payments = data.finance.payments.filter(p => p.cardId === card.id && p.ym === ym).sort((a, b) => a.date.localeCompare(b.date));
    return { ym, closing, due, items, total, payments, ...invoiceState(data, card, ym, todayKey, total) };
}

/** Ocorrências do cartão agrupadas por fatura (fixos até `fixedUntil`). */
function cardInvoices(data, card, fixedUntil, finiteUntil = '9999-12-31') {
    const map = new Map();
    cardEntries(data, card.id).forEach(e => {
        expandEntry(e, '0000-01-01', e.rec?.kind === 'fixed' ? fixedUntil : finiteUntil).forEach(o => {
            o.invoice = invoiceFor(card, o.date);
            if (!map.has(o.invoice)) map.set(o.invoice, []);
            map.get(o.invoice).push(o);
        });
    });
    return map;
}

/**
 * Limite e previsão do cartão.
 * - Usado: o que falta pagar das faturas (inclusive fechadas ou vencidas), as
 *   parcelas futuras (os bancos bloqueiam o valor total da compra parcelada)
 *   e os fixos já lançados. O limite só volta quando a fatura é paga.
 * - Fixos previstos: despesas fixas (streamings, academia…) que ainda vão cair
 *   antes da fatura aberta fechar. Já contam no "livre previsto".
 * - Próximas faturas: total previsto de cada mês com parcelas e fixos, e o
 *   limite livre previsto quando aquela fatura estiver aberta.
 */
export function cardStatus(data, card, todayKey, months = 6) {
    const openYm = invoiceFor(card, todayKey);
    const lastYm = ymShift(openYm, months - 1);
    const horizonEnd = addDaysKey(invoiceDates(card, lastYm).closing, -1);
    const groups = cardInvoices(data, card, horizonEnd);
    const sum = (list) => list.reduce((a, o) => a + o.amount, 0);

    let used = 0, fixedPending = 0, futureInstallments = 0;
    const pending = []; // faturas anteriores à aberta ainda não pagas
    for (const [ym, list] of groups) {
        if (isSettled(card, ym)) continue;
        const paid = paidAmount(data, card.id, ym);
        if (ym > openYm) {
            const finite = sum(list.filter(o => o.kind !== 'fixed'));
            used += Math.max(0, finite - paid);
            futureInstallments += Math.max(0, finite - paid);
            continue;
        }
        const committed = sum(list.filter(o => o.kind !== 'fixed' || o.date <= todayKey));
        const toCome = sum(list.filter(o => o.kind === 'fixed' && o.date > todayKey));
        used += Math.max(0, committed - paid);
        fixedPending += Math.max(0, toCome - Math.max(0, paid - committed));
        if (ym < openYm) {
            const st = invoiceState(data, card, ym, todayKey, sum(list));
            if (st.remaining > 0.005) pending.push({ ym, ...invoiceDates(card, ym), ...st });
        }
    }
    const limit = num(card.limit);
    const free = limit - used;
    const freeForecast = free - fixedPending;

    const upcoming = [];
    for (let i = 0; i < months; i++) {
        const ym = ymShift(openYm, i);
        const list = groups.get(ym) || [];
        const total = sum(list);
        const fixed = sum(list.filter(o => o.kind === 'fixed'));
        let finiteAhead = 0;
        for (const [y, l] of groups) {
            if (y >= ym && !isSettled(card, y)) finiteAhead += Math.max(0, sum(l.filter(o => o.kind !== 'fixed')) - paidAmount(data, card.id, y));
        }
        upcoming.push({
            ym, ...invoiceDates(card, ym), total, fixed, count: list.length,
            paid: paidAmount(data, card.id, ym),
            free: i === 0 ? freeForecast : limit - finiteAhead - fixed
        });
    }

    pending.sort((a, b) => a.ym.localeCompare(b.ym));
    return { openYm, pending, limit, used, fixedPending, futureInstallments, free, freeForecast, upcoming };
}

// ── Saldos e resumos ──────────────────────────────────────────────────
/**
 * Saldo de cada conta no fim do dia `uptoKey`: saldo inicial + receitas −
 * despesas − pagamentos de fatura ± transferências. Para datas futuras, as
 * faturas ainda não pagas que vencem até lá entram como se fossem pagas no
 * vencimento pela conta de pagamento do cartão (previsão).
 */
export function balances(data, uptoKey, todayKey = toDateKey(new Date())) {
    const fin = data.finance;
    const map = new Map(fin.accounts.map(a => [a.id, num(a.initial)]));
    const add = (id, v) => { if (map.has(id)) map.set(id, map.get(id) + v); };

    fin.entries.forEach(e => {
        if (e.cardId) return;
        expandEntry(e, '0000-01-01', uptoKey).forEach(o => add(o.accountId, o.type === 'income' ? o.amount : -o.amount));
    });
    napistaOccurrences(data, '0000-01-01', uptoKey).forEach(o => add(o.accountId, o.type === 'income' ? o.amount : -o.amount));
    fin.payments.forEach(p => { if (p.date <= uptoKey) add(p.accountId, -p.amount); });
    fin.transfers.forEach(t => { if (t.date <= uptoKey) { add(t.fromId, -t.amount); add(t.toId, t.amount); } });

    if (uptoKey > todayKey) {
        fin.cards.forEach(card => {
            for (const [ym, list] of cardInvoices(data, card, uptoKey, uptoKey)) {
                if (isSettled(card, ym) || invoiceDates(card, ym).due > uptoKey) continue;
                const left = list.reduce((a, o) => a + o.amount, 0) - paidAmount(data, card.id, ym);
                if (left > 0.005) add(card.accountId, -left);
            }
        });
    }
    return map;
}

/** Transferências e pagamentos de fatura no intervalo (não são receita nem despesa). */
export function movements(data, fromKey, toKey) {
    const fin = data.finance;
    const out = [];
    fin.transfers.forEach(t => {
        if (t.date >= fromKey && t.date <= toKey) out.push({ id: `tr:${t.id}`, kind: 'transfer', transfer: t, date: t.date, amount: t.amount, desc: t.desc });
    });
    fin.payments.forEach(p => {
        const card = fin.cards.find(c => c.id === p.cardId);
        if (card && p.date >= fromKey && p.date <= toKey) out.push({ id: `pay:${p.id}`, kind: 'payment', payment: p, card, date: p.date, amount: p.amount, accountId: p.accountId });
    });
    return out;
}

export const totalBalance = (data, map) => data.finance.accounts.reduce((a, acc) => a + (map.get(acc.id) || 0), 0);

/** Receitas e despesas do mês pela data de cada lançamento (compras no cartão pela data da compra). */
export function monthSummary(data, ym, todayKey) {
    const { start, end } = monthRange(ym);
    const occs = occurrences(data, start, end);
    const r = { occs, income: 0, expense: 0, cardExpense: 0, byCategory: new Map(), invoices: [] };
    for (const o of occs) {
        if (o.type === 'income') { r.income += o.amount; continue; }
        r.expense += o.amount;
        if (o.cardId) r.cardExpense += o.amount;
        r.byCategory.set(o.categoryId, (r.byCategory.get(o.categoryId) || 0) + o.amount);
    }
    r.result = r.income - r.expense;
    // faturas que vencem neste mês (a fatura do mês "ym" vence nele)
    data.finance.cards.forEach(card => {
        const inv = cardInvoice(data, card, ym, todayKey);
        if (inv.total > 0 && inv.status !== 'settled') r.invoices.push({ card, ...inv });
    });
    r.invoiceTotal = r.invoices.reduce((a, i) => a + i.total, 0);
    return r;
}

/** Próximos lançamentos das contas e vencimentos de fatura nos próximos `days` dias. */
export function upcoming(data, todayKey, days = 10) {
    const from = addDaysKey(todayKey, 1);
    const to = addDaysKey(todayKey, days);
    const items = occurrences(data, from, to).filter(o => !o.cardId && !o.virtual);
    data.finance.cards.forEach(card => {
        for (const ym of [ymOf(from), ymShift(ymOf(from), 1)]) {
            const inv = cardInvoice(data, card, ym, todayKey);
            if (inv.due >= from && inv.due <= to && inv.remaining > 0.005) {
                items.push({ id: `inv:${card.id}:${ym}`, invoice: true, card, ym, date: inv.due, amount: inv.remaining, type: 'expense', desc: `Fatura ${card.name}` });
            }
        }
    });
    return items.sort((a, b) => a.date.localeCompare(b.date));
}

/** Uso de uma conta/categoria/cartão (para impedir exclusões que quebrariam dados). */
export function usage(data, { accountId, categoryId }) {
    const fin = data.finance;
    if (accountId) {
        return fin.entries.filter(e => e.accountId === accountId).length
            + fin.cards.filter(c => c.accountId === accountId).length
            + fin.payments.filter(p => p.accountId === accountId).length
            + fin.transfers.filter(t => t.fromId === accountId || t.toId === accountId).length
            + (fin.integration.accountId === accountId ? 1 : 0);
    }
    if (categoryId) return fin.entries.filter(e => e.categoryId === categoryId || Object.values(e.overrides || {}).some(o => o.categoryId === categoryId)).length;
    return 0;
}
