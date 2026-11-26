// Gestão na Pista: telas do controle financeiro (resumo, lançamentos, cartões e contas).
import * as L from './logic.js?v=2.8.1';
import * as F from './finance.js?v=2.8.1';

export const GESTAO_SCREENS = ['fin-home-screen', 'fin-entries-screen', 'fin-cards-screen', 'fin-accounts-screen'];

const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const MONTHS_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const WEEKDAYS_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const FREQ_LABEL = { weekly: 'semana', monthly: 'mês', yearly: 'ano' };
const FREQ_ADJ = { weekly: 'semanal', monthly: 'mensal', yearly: 'anual' };

const ICON_PREV = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>';
const ICON_NEXT = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>';
const ICON_CARD = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/></svg>';
const ICON_PLUS = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
const ICON_SWAP = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/></svg>';
const ICON_FILTER = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h18l-7 8.5V19l-4 2v-7.5L3 5Z"/></svg>';
const ICON_NOTE = '<svg class="ico note-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6Z"/><path d="M14 3v6h6M8 13h8M8 17h5"/></svg>';
const ICON_X = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
const ICON_TRASH = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/></svg>';

export function createGestao(ctx) {
    const { $, brl, esc, toast, confirmDialog, choiceDialog, parseDecimal, moneyInput, markChanged } = ctx;

    const data = () => ctx.data();
    const fin = () => data().finance;
    const todayKey = () => L.toDateKey(new Date());
    const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

    const ui = {
        month: F.ymOf(todayKey()),
        filter: 'all',
        catFilter: [],        // filtro por categorias (ids)
        tagFilter: [],        // filtro por tags
        cardId: null,
        invoiceYm: null,
        catType: 'expense',
        occMap: new Map(),
        entry: null,          // lançamento em edição: { entryId, idx } (null = novo)
        entryType: 'expense', // 'expense' | 'income' | 'card'
        entryRec: 'once',
        entryCat: null,
        editingCard: null,
        cardColor: F.CARD_COLORS[0],
        editingAccount: null,
        pay: null,            // fatura sendo paga: { cardId, ym, paymentId }
        editingTransfer: null,
        onboardMode: null,
        onboardSince: 'today'
    };

    // ── Formatação ──
    const shortDate = (key) => `${key.slice(8)}/${key.slice(5, 7)}`;
    const fullDate = (key) => `${shortDate(key)}/${key.slice(0, 4)}`;
    const weekdayDate = (key) => `${WEEKDAYS_SHORT[L.parseDateKey(key).getDay()]}, ${shortDate(key)}`;
    const ymLabel = (ym, short = false) => {
        const [y, m] = ym.split('-').map(Number);
        const sameYear = String(y) === todayKey().slice(0, 4);
        return short ? `${MONTHS_SHORT[m - 1]}${sameYear ? '' : '/' + String(y).slice(2)}` : `${MONTHS[m - 1]}${sameYear ? '' : ' ' + y}`;
    };
    const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
    const signedBrl = (o) => `${o.type === 'income' ? '+' : '−'} ${brl(o.amount)}`;

    const account = (id) => fin().accounts.find(a => a.id === id);
    const cardOf = (id) => fin().cards.find(c => c.id === id);
    const categoryOf = (id, type = 'expense') => fin().categories.find(c => c.id === id)
        || fin().categories.find(c => c.id === F.fallbackCategoryId(type))
        || { id: '', name: 'Sem categoria', color: '#64748b', type };
    const categoriesOf = (type) => fin().categories.filter(c => c.type === type && c.id !== F.APPS_CATEGORY_ID);

    const catBadge = (cat) => `<span class="cat-dot" style="--c:${esc(cat.color)}" aria-hidden="true">${esc((cat.name || '?').trim().charAt(0).toUpperCase())}</span>`;

    function recTag(o) {
        if (o.forecast) return '<span class="tag tag-info">Previsão</span>';
        if (o.virtual) return '<span class="tag tag-brand">Na Pista</span>';
        if (o.kind === 'fixed') return '<span class="tag">Fixo</span>';
        if (o.kind === 'installment') return `<span class="tag">${o.n}/${o.total}</span>`;
        if (o.kind === 'repeat') return `<span class="tag">${o.n}/${o.total}</span>`;
        return '';
    }

    function whereLabel(o) {
        if (o.cardId) return `${ICON_CARD}${esc(cardOf(o.cardId)?.name || 'Cartão')}`;
        return esc(account(o.accountId)?.name || 'Conta');
    }

    function occRow(o, { showDate = false } = {}) {
        const cat = categoryOf(o.categoryId, o.type);
        const future = o.date > todayKey();
        ui.occMap.set(o.id, o);
        const sub = [
            showDate ? weekdayDate(o.date) : null,
            o.forecast ? 'Meta líquida do dia' : o.virtual ? esc(o.apps?.length ? o.apps.join(', ') : 'Na Pista') : esc(cat.name),
            `<span class="where">${whereLabel(o)}</span>`,
            o.tags?.length ? `<span class="fin-tags">${o.tags.map(t => `<span class="fin-tag">#${esc(t)}</span>`).join('')}</span>` : null
        ].filter(Boolean).join(' · ');
        return `
        <li><button type="button" class="list-item fin-row${future ? ' is-future' : ''}${o.forecast ? ' is-forecast' : ''}" data-occ="${esc(o.id)}">
            ${catBadge(cat)}
            <span class="item-main">
                <span class="item-title">${esc(o.desc || cat.name)}${o.note ? ` <span role="img" aria-label="Com observação" title="Tem observação">${ICON_NOTE}</span>` : ''} ${recTag(o)}${future && !o.forecast ? ' <span class="tag tag-info">Previsto</span>' : ''}</span>
                <span class="item-sub">${sub}</span>
            </span>
            <span class="item-value ${o.type === 'income' ? 'pos' : 'neg'}">${signedBrl(o)}</span>
        </button></li>`;
    }

    /** Transferências e pagamentos de fatura: movem dinheiro, não são receita nem despesa. */
    function moveRow(m) {
        ui.occMap.set(m.id, m);
        const future = m.date > todayKey();
        let title, sub, icon;
        if (m.kind === 'transfer') {
            const t = m.transfer;
            title = esc(m.desc || 'Transferência');
            sub = `${esc(account(t.fromId)?.name || 'Conta')} → ${esc(account(t.toId)?.name || 'Conta')}`;
            icon = `<span class="cat-dot move-dot" aria-hidden="true">${ICON_SWAP}</span>`;
        } else {
            const [y, mo] = m.payment.ym.split('-').map(Number);
            title = `Fatura ${esc(m.card.name)}`;
            sub = `Fatura de ${MONTHS[mo - 1].toLowerCase()}${String(y) !== todayKey().slice(0, 4) ? ' ' + y : ''} · ${esc(account(m.accountId)?.name || 'Conta')}`;
            icon = `<span class="cc-chip" style="--cc:${esc(m.card.color)}">${ICON_CARD}</span>`;
        }
        return `
        <li><button type="button" class="list-item fin-row${future ? ' is-future' : ''}" data-occ="${esc(m.id)}">
            ${icon}
            <span class="item-main">
                <span class="item-title">${title} ${m.kind === 'payment' ? '<span class="tag">Pagamento</span>' : ''}${future ? ' <span class="tag tag-info">Agendado</span>' : ''}</span>
                <span class="item-sub">${sub}</span>
            </span>
            <span class="item-value move-value">${brl(m.amount)}</span>
        </button></li>`;
    }

    function monthNav() {
        const cur = F.ymOf(todayKey());
        const sub = ui.month === cur ? 'Este mês' : ui.month < cur ? 'Realizado' : 'Previsão';
        return `
        <div class="date-nav">
            <button type="button" class="icon-btn" data-fin-month="-1" aria-label="Mês anterior">${ICON_PREV}</button>
            <div class="date-label is-static"><span class="date-title">${ymLabel(ui.month)}</span><span class="date-sub">${sub}</span></div>
            <button type="button" class="icon-btn" data-fin-month="1" aria-label="Próximo mês">${ICON_NEXT}</button>
        </div>
        <div class="today-row">${ui.month !== cur ? '<button type="button" class="link-btn" data-fin-month="0">Voltar para este mês</button>' : ''}</div>`;
    }

    // ═══════════════════════ Telas ═══════════════════════
    function render(id) {
        if (!data()) return;
        ui.occMap = new Map();
        if (id === 'fin-home-screen') renderHome();
        else if (id === 'fin-entries-screen') renderEntries();
        else if (id === 'fin-cards-screen') renderCards();
        else if (id === 'fin-accounts-screen') renderAccounts();
    }

    function rerender() {
        const active = document.querySelector('.screen.active')?.id;
        if (GESTAO_SCREENS.includes(active)) render(active);
    }

    // ── Resumo ──
    function renderHome() {
        const tk = todayKey();
        const cur = F.ymOf(tk);
        const ym = ui.month;
        const { end } = F.monthRange(ym);
        const sum = F.monthSummary(data(), ym, tk);
        const nowMap = F.balances(data(), tk);
        const endMap = F.balances(data(), end);
        const balNow = F.totalBalance(data(), nowMap);
        const balEnd = F.totalBalance(data(), endMap);
        const accMap = ym === cur ? nowMap : endMap;

        let heroLabel, heroValue, heroSub;
        if (ym === cur) {
            heroLabel = 'Saldo em contas hoje';
            heroValue = balNow;
            heroSub = `Previsto para ${shortDate(end)}: <strong>${brl(balEnd)}</strong>`;
        } else if (ym < cur) {
            heroLabel = `Saldo no fim de ${ymLabel(ym).toLowerCase()}`;
            heroValue = balEnd;
            heroSub = 'contas somadas no fim do mês';
        } else {
            heroLabel = `Saldo previsto em ${shortDate(end)}`;
            heroValue = balEnd;
            heroSub = 'com os fixos, parcelas e faturas a pagar até lá';
        }

        const accounts = fin().accounts.map(a => `
            <li><button type="button" class="list-item" data-goto="fin-accounts-screen">
                <span class="item-main"><span class="item-title">${esc(a.name)}</span><span class="item-sub">${esc(F.ACCOUNT_KINDS[a.kind] || '')}</span></span>
                <span class="item-value ${accMap.get(a.id) < 0 ? 'neg' : ''}">${brl(accMap.get(a.id) || 0)}</span>
            </button></li>`).join('');

        const alerts = [];
        const cards = fin().cards.map(c => {
            const st = F.cardStatus(data(), c, tk, 1);
            const inv = F.cardInvoice(data(), c, st.openYm, tk);
            st.pending.forEach(pv => alerts.push({ card: c, ...pv }));
            const late = st.pending.some(pv => pv.status === 'overdue');
            return `
            <li><button type="button" class="list-item" data-goto-card="${esc(c.id)}">
                <span class="cc-chip" style="--cc:${esc(c.color)}">${ICON_CARD}</span>
                <span class="item-main"><span class="item-title">${esc(c.name)}${late ? ' <span class="tag tag-danger">Vencida</span>' : ''}</span><span class="item-sub">Fatura de ${ymLabel(st.openYm, true)} · vence ${shortDate(inv.due)}</span></span>
                <span class="item-value">${brl(inv.total)}<small>livre ${brl(st.freeForecast)}</small></span>
            </button></li>`;
        }).join('');
        const alertsHtml = alerts.map(a => `
            <section class="card fin-alert" data-state="${a.status}">
                <div>
                    <strong>Fatura ${esc(a.card.name)} de ${ymLabel(a.ym).toLowerCase()} ${a.status === 'overdue' ? 'vencida' : 'fechada'}</strong>
                    <span>${a.status === 'overdue' ? `Venceu em ${shortDate(a.due)}` : `Vence em ${shortDate(a.due)}`} · falta pagar ${brl(a.remaining)}</span>
                </div>
                <button type="button" class="btn btn-sm ${a.status === 'overdue' ? 'btn-danger' : 'btn-primary'}" data-pay="${esc(a.card.id)}" data-pay-ym="${a.ym}">Pagar</button>
            </section>`).join('');

        const cats = [...sum.byCategory.entries()].sort((a, b) => b[1] - a[1]);
        const max = cats.length ? cats[0][1] : 0;
        const bars = cats.length
            ? cats.map(([id, v]) => {
                const cat = categoryOf(id, 'expense');
                return `
                <div class="hbar">
                    <div class="hbar-head"><span>${esc(cat.name)}</span><span>${brl(v)}<small>${sum.expense > 0 ? Math.round(v / sum.expense * 100) : 0}%</small></span></div>
                    <div class="hbar-track"><div class="hbar-fill" style="width:${(v / max * 100).toFixed(1)}%; --c:${esc(cat.color)}"></div></div>
                </div>`;
            }).join('')
            : '<p class="muted small">Nenhuma despesa neste mês.</p>';

        const next = F.upcoming(data(), tk, 10);
        const nextHtml = next.length
            ? next.map(o => o.invoice
                ? `<li><button type="button" class="list-item" data-goto-card="${esc(o.card.id)}" data-goto-invoice="${o.ym}">
                        <span class="cc-chip" style="--cc:${esc(o.card.color)}">${ICON_CARD}</span>
                        <span class="item-main"><span class="item-title">${esc(o.desc)}</span><span class="item-sub">${weekdayDate(o.date)} · vencimento · ${esc(account(o.card.accountId)?.name || 'conta')}</span></span>
                        <span class="item-value neg">− ${brl(o.amount)}</span>
                    </button></li>`
                : occRow(o, { showDate: true })).join('')
            : '<li class="empty">Nada programado para os próximos 10 dias.</li>';

        const integ = fin().integration;
        const fcOn = fin().forecast && F.canForecast(data());
        const fcHint = sum.forecastDays
            ? `+ ${brl(sum.forecast)} em ${plural(sum.forecastDays, 'dia de trabalho', 'dias de trabalho')} ainda não ${sum.forecastDays === 1 ? 'lançado' : 'lançados'}`
            : 'nenhum dia de trabalho a prever neste mês';
        $('fin-home-body').innerHTML = `
            ${monthNav()}
            <section class="card hero fin-hero" data-state="${heroValue < 0 ? 'missed' : 'progress'}">
                <span class="eyebrow">${heroLabel}</span>
                <div class="hero-value ${heroValue < 0 ? 'neg' : ''}">${brl(heroValue)}</div>
                <p class="hero-sub">${heroSub}</p>
            </section>
            ${forecastCard(fcOn, fcHint)}
            ${ym === cur ? alertsHtml : ''}
            <section class="stat-grid" aria-label="Resumo do mês">
                <button type="button" class="stat stat-btn" data-goto-filter="income"><span class="stat-label">Receitas</span><span class="stat-value pos">${brl(sum.income)}</span><span class="stat-sub">${fcOn && sum.forecast > 0 ? `${brl(sum.forecast)} previstos` : integ.mode === 'gross' ? 'apps pelo bruto' : 'apps pelo líquido'}</span></button>
                <button type="button" class="stat stat-btn" data-goto-filter="expense"><span class="stat-label">Despesas</span><span class="stat-value neg">${brl(sum.expense)}</span><span class="stat-sub">${sum.cardExpense > 0 ? `${brl(sum.cardExpense)} no cartão` : 'contas e cartões'}</span></button>
                <div class="stat"><span class="stat-label">${fcOn && sum.forecast > 0 ? 'Resultado previsto' : 'Resultado do mês'}</span><span class="stat-value ${sum.result < 0 ? 'neg' : 'pos'}">${brl(sum.result)}</span><span class="stat-sub">${fcOn && sum.forecast > 0 ? `lançado: ${brl(sum.realResult)}` : 'receitas − despesas'}</span></div>
                <button type="button" class="stat stat-btn" data-goto="fin-cards-screen"><span class="stat-label">Faturas do mês</span><span class="stat-value">${brl(sum.invoiceTotal)}</span><span class="stat-sub">${sum.invoices.length ? plural(sum.invoices.length, 'cartão', 'cartões') : 'nenhuma fatura'}</span></button>
            </section>
            <section class="card">
                <div class="card-head"><h2 class="card-title">Contas <span class="card-total">${brl(F.totalBalance(data(), accMap))}</span></h2><button type="button" class="btn btn-soft btn-sm btn-icon-text" data-new-transfer>${ICON_SWAP}Transferir</button></div>
                <ul class="list list-select">${accounts}</ul>
            </section>
            <section class="card">
                <div class="card-head"><h2 class="card-title">Cartões de crédito</h2>${fin().cards.length ? '' : '<button type="button" class="btn btn-soft btn-sm btn-icon-text" data-new-card>' + ICON_PLUS + 'Cadastrar</button>'}</div>
                ${cards ? `<ul class="list list-select">${cards}</ul>` : '<p class="muted small">Cadastre seus cartões para ver a fatura e o limite já descontando as parcelas e os gastos fixos que vão cair.</p>'}
            </section>
            <section class="card">
                <h2 class="card-title">Para onde vai o dinheiro</h2>
                <div class="hbars">${bars}</div>
            </section>
            <section class="card">
                <h2 class="card-title">Próximos 10 dias</h2>
                <ul class="list list-select">${nextHtml}</ul>
            </section>`;
    }

    /** Liga/desliga da previsão com metas (meta líquida diária nos dias ainda não lançados). */
    function forecastCard(on, hint) {
        const can = F.canForecast(data());
        const daily = can ? L.dailyTarget(data().settings, L.parseDateKey(`${ui.month}-01`)) : 0;
        const sub = !can
            ? 'Defina a meta mensal no Na Pista (Ajustes) para usar a previsão.'
            : on ? `${hint}. Meta de ${brl(daily)} líquidos por dia.`
            : `Mostra a receita e o resultado do mês se você bater a meta de ${brl(daily)} líquidos por dia.`;
        return `
            <section class="card fin-forecast${on ? ' is-on' : ''}">
                <label class="switch-row">
                    <span class="switch-text"><strong>Previsão com metas</strong><span>${sub}</span></span>
                    <input type="checkbox" class="switch" id="fin-forecast-toggle" ${on ? 'checked' : ''} ${can ? '' : 'disabled'}>
                </label>
            </section>`;
    }

    // ── Lançamentos ──
    function renderEntries() {
        const { start, end } = F.monthRange(ui.month);
        const filtering = ui.catFilter.length > 0 || ui.tagFilter.length > 0;
        const all = F.occurrences(data(), start, end).filter(matchesFilter);
        const income = all.filter(o => o.type === 'income').reduce((a, o) => a + o.amount, 0);
        const fcTotal = all.filter(o => o.forecast).reduce((a, o) => a + o.amount, 0);
        const expense = all.filter(o => o.type === 'expense').reduce((a, o) => a + o.amount, 0);
        const list = all.filter(o => ui.filter === 'all' ? true
            : ui.filter === 'card' ? !!o.cardId
            : o.type === ui.filter);
        // transferências e faturas não têm categoria nem tag: somem quando há filtro
        if (ui.filter === 'all' && !filtering) list.push(...F.movements(data(), start, end));
        list.sort((a, b) => b.date.localeCompare(a.date));

        const groups = new Map();
        list.forEach(o => { if (!groups.has(o.date)) groups.set(o.date, []); groups.get(o.date).push(o); });
        const tk = todayKey();
        const rows = [...groups.entries()].map(([key, items]) => {
            const day = items.reduce((a, o) => a + (o.kind === 'transfer' || o.kind === 'payment' ? 0 : o.type === 'income' ? o.amount : -o.amount), 0);
            const label = key === tk ? 'Hoje' : key === F.addDaysKey(tk, -1) ? 'Ontem' : key === F.addDaysKey(tk, 1) ? 'Amanhã' : weekdayDate(key);
            const onlyMoves = items.every(o => o.kind === 'transfer' || o.kind === 'payment');
            return `<li class="day-head"><span>${label}</span>${onlyMoves ? '' : `<span class="${day < 0 ? 'neg' : 'pos'}">${day < 0 ? '−' : '+'} ${brl(Math.abs(day))}</span>`}</li>` + items.map(o => (o.kind === 'transfer' || o.kind === 'payment' ? moveRow(o) : occRow(o))).join('');
        }).join('');

        const filters = [['all', 'Todos'], ['income', 'Receitas'], ['expense', 'Despesas'], ['card', 'Cartão']];
        $('fin-entries-body').innerHTML = `
            ${monthNav()}
            <div class="seg" role="tablist" aria-label="Filtrar lançamentos">
                ${filters.map(([k, label]) => `<button type="button" role="tab" class="seg-btn${ui.filter === k ? ' active' : ''}" data-fin-filter="${k}" aria-selected="${ui.filter === k}">${label}</button>`).join('')}
            </div>
            ${filterBar()}
            <div class="fin-totals">
                <span>Receitas<strong class="pos">${brl(income)}</strong></span>
                <span>Despesas<strong class="neg">${brl(expense)}</strong></span>
                <span>Resultado<strong class="${income - expense < 0 ? 'neg' : 'pos'}">${brl(income - expense)}</strong></span>
            </div>
            ${fcTotal > 0 ? `<p class="fin-forecast-note">Inclui ${brl(fcTotal)} de previsão pela meta diária. Desligue em Resumo para ver só os lançados.</p>` : ''}
            <section class="card card-list">
                <ul class="list list-select fin-list">${rows || (filtering ? '<li class="empty">Nenhum lançamento com esses filtros neste mês.</li>' : '<li class="empty">Nenhum lançamento neste mês. Toque em + para lançar.</li>')}</ul>
            </section>`;
    }

    // ── Filtros por categoria e tag ──
    function matchesFilter(o) {
        // compara com a categoria mostrada na linha (a de um lançamento sem categoria válida é "Outros")
        if (ui.catFilter.length && !ui.catFilter.includes(categoryOf(o.categoryId, o.type).id)) return false;
        if (ui.tagFilter.length && !ui.tagFilter.some(t => F.hasTag(o.tags, t))) return false;
        return true;
    }

    function filterBar() {
        const n = ui.catFilter.length + ui.tagFilter.length;
        const chips = [
            ...ui.catFilter.map(id => {
                const c = categoryOf(id);
                const dup = fin().categories.some(x => x.id !== c.id && x.name.toLowerCase() === c.name.toLowerCase());
                const name = dup ? `${c.name} (${c.type === 'income' ? 'receita' : 'despesa'})` : c.name;
                return `<button type="button" class="chip chip-active" data-unfilter-cat="${esc(id)}" aria-label="Tirar filtro ${esc(name)}"><span class="plat-dot" style="--c:${esc(c.color)}"></span>${esc(name)}${ICON_X}</button>`;
            }),
            ...ui.tagFilter.map(t => `<button type="button" class="chip chip-active" data-unfilter-tag="${esc(t)}" aria-label="Tirar filtro ${esc(t)}">#${esc(t)}${ICON_X}</button>`)
        ].join('');
        return `
            <div class="filter-bar">
                <button type="button" class="chip${n ? ' chip-active' : ''}" data-open-filter>${ICON_FILTER}Filtrar${n ? ` <span class="filter-count">${n}</span>` : ''}</button>
                ${chips}
                ${n > 1 ? '<button type="button" class="filter-clear" data-clear-filter>Limpar</button>' : ''}
            </div>`;
    }

    function openFilter() {
        renderFilter();
        $('fin-filter-dialog').showModal();
    }

    function renderFilter() {
        // despesas e receitas separadas: as duas têm um "Outros", por exemplo
        const group = (label, cats) => `
            <span class="filter-group">${label}</span>
            <div class="chips chips-sm cat-chips" role="group" aria-label="Categorias de ${label.toLowerCase()}">${cats.map(c => `
                <button type="button" class="chip cat-chip" data-filter-cat="${esc(c.id)}" aria-pressed="${ui.catFilter.includes(c.id)}"><span class="plat-dot" style="--c:${esc(c.color)}"></span>${esc(c.name)}</button>`).join('')}
            </div>`;
        $('fin-filter-cats').innerHTML = group('Despesas', categoriesOf('expense')) + group('Receitas', fin().categories.filter(c => c.type === 'income'));
        // tags marcadas que não existem mais continuam aparecendo para poder desmarcar
        const tags = F.allTags(data());
        ui.tagFilter.forEach(t => { if (!F.hasTag(tags, t)) tags.push(t); });
        $('fin-filter-tags').innerHTML = tags.length
            ? tags.map(t => `<button type="button" class="chip" data-filter-tag="${esc(t)}" aria-pressed="${F.hasTag(ui.tagFilter, t)}">#${esc(t)}</button>`).join('')
            : '<p class="hint" style="margin:0">Nenhuma tag ainda. Adicione tags ao lançar (ex: viagem, trabalho).</p>';
    }

    const toggleIn = (list, v, eq = (a, b) => a === b) => (list.some(x => eq(x, v)) ? list.filter(x => !eq(x, v)) : [...list, v]);
    const sameTag = (a, b) => F.hasTag([a], b);

    // ── Cartões ──
    const STATUS_LABEL = { open: 'Aberta', closed: 'Fechada', overdue: 'Vencida', paid: 'Paga', empty: 'Sem gastos', settled: 'Anterior ao cadastro' };
    const STATUS_BADGE = { paid: 'badge-brand', closed: 'badge-warn', overdue: 'badge-danger' };

    function renderCards() {
        const cards = fin().cards;
        const body = $('fin-cards-body');
        if (!cards.length) {
            body.innerHTML = `
            <div class="empty-state">
                <div class="empty-ico">${ICON_CARD.replace('class="ico"', 'class="ico" style="width:44px;height:44px"')}</div>
                <p>Nenhum cartão cadastrado.</p>
                <p class="muted small">Cadastre o cartão com limite, dia de fechamento e de vencimento. As parcelas e os gastos fixos (streamings, academia…) já aparecem nas próximas faturas e no limite.</p>
                <button type="button" class="btn btn-primary" data-new-card style="margin-top:18px">Cadastrar cartão</button>
            </div>`;
            return;
        }
        if (!cardOf(ui.cardId)) { ui.cardId = cards[0].id; ui.invoiceYm = null; }
        const c = cardOf(ui.cardId);
        const tk = todayKey();
        const st = F.cardStatus(data(), c, tk, 6);
        if (!ui.invoiceYm) ui.invoiceYm = st.pending.length ? st.pending[0].ym : st.openYm;
        const inv = F.cardInvoice(data(), c, ui.invoiceYm, tk);

        const pct = (v) => (st.limit > 0 ? Math.max(0, Math.min(100, v / st.limit * 100)) : 0);
        const usedPct = pct(st.used);
        const fixedPct = Math.min(100 - usedPct, pct(st.fixedPending));
        const over = st.freeForecast < 0;

        const selector = cards.length > 1 ? `
            <div class="chips chips-sm cc-selector" role="tablist" aria-label="Cartões">
                ${cards.map(x => `<button type="button" class="chip" role="tab" data-card-select="${esc(x.id)}" aria-pressed="${x.id === c.id}"><span class="plat-dot" style="--c:${esc(x.color)}"></span>${esc(x.name)}</button>`).join('')}
            </div>` : '';

        const statusText = inv.status === 'open' ? `Fecha ${shortDate(inv.closing)} · vence ${shortDate(inv.due)}`
            : inv.status === 'overdue' ? `Venceu em ${shortDate(inv.due)}`
            : inv.status === 'settled' ? `Venceu em ${shortDate(inv.due)}, antes do cadastro`
            : `Fechou ${shortDate(inv.closing)} · vence ${shortDate(inv.due)}`;
        const payments = inv.payments.map(pm => {
            const m = { id: `pay:${pm.id}`, kind: 'payment', payment: pm, card: c, date: pm.date, amount: pm.amount, accountId: pm.accountId };
            return moveRow(m);
        }).join('');
        const canPay = inv.remaining > 0.005 && inv.status !== 'settled';
        const payBlock = `
            ${inv.paid > 0.005 ? `<div class="invoice-paid"><span>Pago ${brl(inv.paid)}</span>${canPay ? `<span>Falta <strong>${brl(inv.remaining)}</strong></span>` : ''}</div>` : ''}
            ${canPay ? `<button type="button" class="btn ${inv.status === 'overdue' ? 'btn-danger' : inv.status === 'closed' ? 'btn-primary' : 'btn-soft'}" data-pay="${esc(c.id)}" data-pay-ym="${inv.ym}" style="margin:12px 0 4px">${inv.status === 'open' ? 'Adiantar pagamento' : 'Pagar fatura'} · ${brl(inv.remaining)}</button>` : ''}
            ${payments ? `<ul class="list list-select fin-list invoice-payments">${payments}</ul>` : ''}`;
        const pendingHtml = st.pending.map(pv => `
            <div class="fin-alert inline" data-state="${pv.status}">
                <div><strong>Fatura de ${ymLabel(pv.ym).toLowerCase()} ${pv.status === 'overdue' ? 'vencida' : 'fechada'}</strong><span>falta pagar ${brl(pv.remaining)} · vence ${shortDate(pv.due)}</span></div>
                <button type="button" class="btn btn-sm ${pv.status === 'overdue' ? 'btn-danger' : 'btn-primary'}" data-pay="${esc(c.id)}" data-pay-ym="${pv.ym}">Pagar</button>
            </div>`).join('');
        const invItems = inv.items.length
            ? inv.items.map(o => occRow(o, { showDate: true })).join('')
            : '<li class="empty">Nenhuma compra nesta fatura.</li>';
        const invFixed = inv.items.filter(o => o.kind === 'fixed' && o.date > tk).reduce((a, o) => a + o.amount, 0);

        const rows = st.upcoming.map(u => `
            <li class="proj-row${u.ym === ui.invoiceYm ? ' selected' : ''}">
                <button type="button" class="list-item" data-invoice="${u.ym}">
                    <span class="item-main"><span class="item-title">${ymLabel(u.ym)}</span><span class="item-sub">vence ${shortDate(u.due)}${u.fixed > 0 ? ` · ${brl(u.fixed)} de fixos` : ''}${u.paid > 0.005 ? ` · pago ${brl(u.paid)}` : ''}</span></span>
                    <span class="item-value">${brl(u.total)}<small class="${u.free < 0 ? 'neg' : ''}">livre ≈ ${brl(u.free)}</small></span>
                </button>
            </li>`).join('');

        body.innerHTML = `
            ${selector}
            <section class="card cc-card" style="--cc:${esc(c.color)}">
                <div class="card-head">
                    <div class="cc-title"><span class="cc-chip">${ICON_CARD}</span><div><h2 class="card-title">${esc(c.name)}</h2><p class="item-sub">Fecha dia ${c.closingDay} · vence dia ${c.dueDay}</p></div></div>
                    <button type="button" class="btn btn-ghost btn-sm" data-edit-card="${esc(c.id)}">Editar</button>
                </div>
                <div class="cc-limit">
                    <span class="eyebrow">Limite livre previsto</span>
                    <div class="hero-value ${over ? 'neg' : ''}">${brl(st.freeForecast)}</div>
                    <p class="hero-sub">de ${brl(st.limit)} · livre agora ${brl(st.free)}</p>
                </div>
                <div class="limit-bar" role="img" aria-label="Uso do limite">
                    <span class="limit-used" style="width:${usedPct.toFixed(1)}%"></span>
                    <span class="limit-fixed" style="width:${fixedPct.toFixed(1)}%"></span>
                </div>
                <div class="legend">
                    <div class="legend-row"><span><i class="legend-dot limit-used"></i>Usado (falta pagar)</span><strong>${brl(st.used)}</strong></div>
                    ${st.futureInstallments > 0 ? `<div class="legend-row legend-sub"><span>inclui parcelas das próximas faturas</span><span>${brl(st.futureInstallments)}</span></div>` : ''}
                    <div class="legend-row"><span><i class="legend-dot limit-fixed"></i>Fixos que ainda vão cair</span><strong>${brl(st.fixedPending)}</strong></div>
                    <div class="legend-row"><span><i class="legend-dot legend-free"></i>Livre previsto</span><strong class="${over ? 'neg' : ''}">${brl(st.freeForecast)}</strong></div>
                </div>
                ${pendingHtml}
                <button type="button" class="btn btn-soft" data-new-card-entry="${esc(c.id)}" style="margin-top:14px">${ICON_PLUS}Nova compra no cartão</button>
            </section>

            <section class="card">
                <div class="date-nav">
                    <button type="button" class="icon-btn" data-invoice-step="-1" aria-label="Fatura anterior">${ICON_PREV}</button>
                    <div class="date-label is-static"><span class="date-title">Fatura de ${ymLabel(inv.ym)}</span><span class="date-sub">${statusText}</span></div>
                    <button type="button" class="icon-btn" data-invoice-step="1" aria-label="Próxima fatura">${ICON_NEXT}</button>
                </div>
                <div class="invoice-total">
                    <span class="badge ${STATUS_BADGE[inv.status] || ''}">${STATUS_LABEL[inv.status]}</span>
                    <strong>${brl(inv.total)}</strong>
                </div>
                ${payBlock}
                ${invFixed > 0 ? `<p class="hint">Inclui ${brl(invFixed)} de gastos fixos previstos que ainda não caíram.</p>` : ''}
                <ul class="list list-select fin-list">${invItems}</ul>
            </section>

            <section class="card">
                <h2 class="card-title">Próximas faturas</h2>
                <p class="muted small">Total previsto de cada fatura com as parcelas e os gastos fixos, e quanto do limite deve sobrar.</p>
                <ul class="list list-select proj-list">${rows}</ul>
            </section>`;
    }

    // ── Contas e ajustes ──
    function renderAccounts() {
        const tk = todayKey();
        const map = F.balances(data(), tk);
        const integ = fin().integration;
        const accOptions = fin().accounts.map(a => `<option value="${esc(a.id)}"${a.id === integ.accountId ? ' selected' : ''}>${esc(a.name)}</option>`).join('');
        const sinceOpt = integ.since ? integ.since : '';
        const cats = fin().categories.filter(c => c.type === ui.catType);

        $('fin-accounts-body').innerHTML = `
            <section class="card">
                <div class="card-head">
                    <h2 class="card-title">Contas</h2>
                    <div class="head-actions">
                        <button type="button" class="btn btn-ghost btn-sm btn-icon-text" data-new-transfer>${ICON_SWAP}Transferir</button>
                        <button type="button" class="btn btn-soft btn-sm btn-icon-text" data-new-account>${ICON_PLUS}Nova conta</button>
                    </div>
                </div>
                <ul class="list list-select">
                    ${fin().accounts.map(a => `
                    <li><button type="button" class="list-item" data-edit-account="${esc(a.id)}">
                        <span class="item-main"><span class="item-title">${esc(a.name)}</span><span class="item-sub">${esc(F.ACCOUNT_KINDS[a.kind] || '')}${a.id === integ.accountId ? ' · recebe os ganhos dos apps' : ''}</span></span>
                        <span class="item-value ${map.get(a.id) < 0 ? 'neg' : ''}">${brl(map.get(a.id) || 0)}</span>
                    </button></li>`).join('')}
                </ul>
                <div class="list-foot"><span>Total</span><strong>${brl(F.totalBalance(data(), map))}</strong></div>
            </section>

            <section class="card">
                <div class="card-head">
                    <h2 class="card-title">Cartões de crédito</h2>
                    <button type="button" class="btn btn-soft btn-sm btn-icon-text" data-new-card>${ICON_PLUS}Novo cartão</button>
                </div>
                <ul class="list list-select">
                    ${fin().cards.map(c => `
                    <li><button type="button" class="list-item" data-edit-card="${esc(c.id)}">
                        <span class="cc-chip" style="--cc:${esc(c.color)}">${ICON_CARD}</span>
                        <span class="item-main"><span class="item-title">${esc(c.name)}</span><span class="item-sub">Fecha dia ${c.closingDay} · vence dia ${c.dueDay}</span></span>
                        <span class="item-value">${brl(c.limit)}<small>limite</small></span>
                    </button></li>`).join('') || '<li class="empty">Nenhum cartão cadastrado.</li>'}
                </ul>
            </section>

            <section class="card">
                <h2 class="card-title">Ganhos do Na Pista</h2>
                <p class="muted small">Cada dia lançado no Na Pista entra aqui sozinho. Se você alterar o dia lá, o valor muda aqui também.</p>
                <div class="field" style="margin-top:12px">
                    <span class="field-label">Valor que entra na gestão</span>
                    <div class="seg" role="tablist" aria-label="Valor enviado">
                        <button type="button" role="tab" class="seg-btn${integ.mode === 'net' ? ' active' : ''}" data-integ-mode="net" aria-selected="${integ.mode === 'net'}">Líquido</button>
                        <button type="button" role="tab" class="seg-btn${integ.mode === 'gross' ? ' active' : ''}" data-integ-mode="gross" aria-selected="${integ.mode === 'gross'}">Bruto</button>
                    </div>
                    <p class="hint" style="margin-top:0">${integ.mode === 'gross'
                        ? 'Bruto: entra o que os apps pagaram menos os gastos do dia lançados no Na Pista. Lance o combustível aqui na gestão.'
                        : 'Líquido: entra o que sobra depois do combustível estimado e dos gastos do dia lançados no Na Pista.'}</p>
                </div>
                <div class="grid-2">
                    <label class="field"><span class="field-label">Conta que recebe</span><select id="fin-integ-account">${accOptions}</select></label>
                    <label class="field"><span class="field-label">Considerar a partir de</span><input type="date" id="fin-integ-since" value="${esc(sinceOpt)}"></label>
                </div>
                <p class="hint" style="margin-top:0">${integ.since ? `Dias lançados antes de ${fullDate(integ.since)} não entram no saldo.` : 'Todos os dias lançados no Na Pista entram no saldo.'}</p>
            </section>

            <section class="card">
                <h2 class="card-title">Categorias</h2>
                <div class="seg" role="tablist" aria-label="Tipo de categoria">
                    <button type="button" role="tab" class="seg-btn${ui.catType === 'expense' ? ' active' : ''}" data-cat-type="expense" aria-selected="${ui.catType === 'expense'}">Despesas</button>
                    <button type="button" role="tab" class="seg-btn${ui.catType === 'income' ? ' active' : ''}" data-cat-type="income" aria-selected="${ui.catType === 'income'}">Receitas</button>
                </div>
                <ul class="list">
                    ${cats.map(c => `
                    <li class="list-item">
                        ${catBadge(c)}
                        <span class="item-main"><span class="item-title">${esc(c.name)}</span>${F.isSystemCategory(c.id) ? `<span class="item-sub">${c.id === F.APPS_CATEGORY_ID ? 'usada pelos ganhos do Na Pista' : 'padrão'}</span>` : ''}</span>
                        ${F.isSystemCategory(c.id) ? '' : `<button type="button" class="icon-btn" data-del-cat="${esc(c.id)}" aria-label="Excluir ${esc(c.name)}">${ICON_TRASH}</button>`}
                    </li>`).join('')}
                </ul>
                <form class="add-row" id="fin-cat-form">
                    <input type="text" id="fin-cat-name" placeholder="Nova categoria" maxlength="30" autocomplete="off">
                    <button type="submit" class="btn btn-soft btn-icon-text">${ICON_PLUS}Adicionar</button>
                </form>
            </section>`;
    }

    // ═══════════════════════ Lançamento (diálogo) ═══════════════════════
    function openEntry({ type = 'expense', cardId = null, occ = null } = {}) {
        if (type === 'card' && !fin().cards.length) {
            toast('Cadastre um cartão de crédito primeiro.', { action: 'Cadastrar', onAction: () => openCard() });
            return;
        }
        const e = occ ? occ.entry : null;
        ui.entry = e ? { entryId: e.id, idx: occ.idx } : null;
        ui.entryType = e ? (e.cardId ? 'card' : e.type) : type;
        ui.entryRec = e ? e.rec.kind : 'once';
        const isInst = e?.rec.kind === 'installment';

        $('fin-entry-title').textContent = !e ? 'Novo lançamento' : isInst ? 'Editar compra parcelada' : e.rec.kind === 'once' ? 'Editar lançamento' : 'Editar lançamento recorrente';
        $('fin-entry-amount').value = e ? moneyInput(isInst ? e.amount : occ.amount) : '';
        $('fin-entry-desc').value = e ? (occ.desc || '') : '';
        $('fin-entry-tags').value = e ? (occ.tags || []).join(', ') : '';
        $('fin-entry-note').value = e ? (occ.note || '') : '';
        renderTagSuggest();
        $('fin-entry-date').value = e ? (isInst ? e.date : occ.date) : todayKey();
        $('fin-entry-count').value = e?.rec.count ? String(e.rec.count) : '';
        $('fin-entry-installments').value = isInst ? String(e.rec.count) : '';
        $('fin-entry-freq').value = e?.rec.freq || 'monthly';
        $('fin-entry-fixed-freq').value = e?.rec.freq || 'monthly';
        ui.entryCat = e ? occ.categoryId : null;

        fillSelect('fin-entry-account', fin().accounts, e && !e.cardId ? (occ.accountId || e.accountId) : fin().integration.accountId);
        fillSelect('fin-entry-card', fin().cards, e?.cardId || cardId || ui.cardId || fin().cards[0]?.id);
        $('fin-entry-delete').hidden = !e;
        // tipo e repetição da série só mudam por "Todos": em séries, deixa claro na dica
        renderEntryType();
        $('fin-entry-dialog').showModal();
        if (!e) setTimeout(() => $('fin-entry-amount').focus(), 50);
    }

    /** Tags já usadas que ainda não estão no campo: um toque adiciona. */
    function renderTagSuggest() {
        const typed = F.parseTags($('fin-entry-tags').value);
        const list = F.allTags(data()).filter(t => !F.hasTag(typed, t)).slice(0, 12);
        const el = $('fin-entry-tag-suggest');
        el.hidden = !list.length || typed.length >= F.MAX_TAGS;
        el.innerHTML = list.map(t => `<button type="button" class="chip" data-add-tag="${esc(t)}">${esc(t)}</button>`).join('');
    }

    function fillSelect(id, items, selected) {
        $(id).innerHTML = items.map(x => `<option value="${esc(x.id)}"${x.id === selected ? ' selected' : ''}>${esc(x.name)}</option>`).join('');
    }

    function renderEntryType() {
        const t = ui.entryType;
        $('fin-entry-type').querySelector('[data-entry-type="transfer"]').hidden = !!ui.entry;
        document.querySelectorAll('#fin-entry-type .seg-btn').forEach(b => {
            const on = b.dataset.entryType === t;
            b.classList.toggle('active', on);
            b.setAttribute('aria-selected', String(on));
        });
        $('fin-entry-account-field').hidden = t === 'card';
        $('fin-entry-card-field').hidden = t !== 'card';
        const catType = t === 'income' ? 'income' : 'expense';
        const cats = catType === 'income' ? fin().categories.filter(c => c.type === 'income') : categoriesOf('expense');
        if (!cats.some(c => c.id === ui.entryCat)) ui.entryCat = null;
        $('fin-entry-cats').innerHTML = cats.map(c => `
            <button type="button" class="chip cat-chip" data-cat="${esc(c.id)}" aria-pressed="${c.id === ui.entryCat}"><span class="plat-dot" style="--c:${esc(c.color)}"></span>${esc(c.name)}</button>`).join('');
        // parcelar só faz sentido para despesas
        $('fin-rec-installment').hidden = t === 'income';
        if (t === 'income' && ui.entryRec === 'installment') ui.entryRec = 'once';
        renderEntryRec();
    }

    function renderEntryRec() {
        const r = ui.entryRec;
        document.querySelectorAll('#fin-entry-rec .seg-btn').forEach(b => {
            const on = b.dataset.rec === r;
            b.classList.toggle('active', on);
            b.setAttribute('aria-selected', String(on));
        });
        $('fin-rec-fixed').hidden = r !== 'fixed';
        $('fin-rec-repeat').hidden = r !== 'repeat';
        $('fin-rec-inst').hidden = r !== 'installment';
        $('fin-entry-amount-label').textContent = r === 'installment' ? 'Valor total da compra'
            : r === 'fixed' ? 'Valor de cada vez'
            : r === 'repeat' ? 'Valor de cada lançamento'
            : 'Valor';
        updateEntryPreview();
    }

    function readEntryForm() {
        const rec = { kind: ui.entryRec };
        if (rec.kind === 'fixed') rec.freq = $('fin-entry-fixed-freq').value;
        if (rec.kind === 'repeat') { rec.count = parseInt($('fin-entry-count').value, 10) || 0; rec.freq = $('fin-entry-freq').value; }
        if (rec.kind === 'installment') rec.count = parseInt($('fin-entry-installments').value, 10) || 0;
        const card = ui.entryType === 'card';
        return {
            type: card ? 'expense' : ui.entryType,
            amount: parseDecimal($('fin-entry-amount').value),
            desc: $('fin-entry-desc').value.trim(),
            note: $('fin-entry-note').value.trim(),
            tags: F.parseTags($('fin-entry-tags').value),
            date: $('fin-entry-date').value,
            categoryId: ui.entryCat,
            accountId: card ? null : $('fin-entry-account').value,
            cardId: card ? $('fin-entry-card').value : null,
            rec
        };
    }

    function updateEntryPreview() {
        const f = readEntryForm();
        const el = $('fin-entry-preview');
        const rows = [];
        if (f.amount > 0 && f.date) {
            if (f.rec.kind === 'installment' && f.rec.count >= 2) {
                rows.push([`${f.rec.count}x de`, brl(F.installmentValue(f.amount, f.rec.count, 1))]);
                const first = F.installmentValue(f.amount, f.rec.count, 0);
                if (Math.abs(first - F.installmentValue(f.amount, f.rec.count, 1)) > 0.001) rows.push(['1ª parcela', brl(first)]);
                rows.push(['Última parcela', ymLabel(F.ymOf(F.addMonthsKey(f.date, f.rec.count - 1)))]);
            } else if (f.rec.kind === 'repeat' && f.rec.count >= 2) {
                const last = F.occurrenceDate({ date: f.date, rec: f.rec }, f.rec.count - 1);
                rows.push([`${f.rec.count} lançamentos de`, brl(f.amount)]);
                rows.push(['Total', brl(f.amount * f.rec.count)]);
                rows.push(['Último', fullDate(last)]);
            } else if (f.rec.kind === 'fixed') {
                rows.push([`Todo ${FREQ_LABEL[f.rec.freq]}`, brl(f.amount)]);
                if (f.rec.freq === 'monthly') rows.push(['No ano', brl(f.amount * 12)]);
            }
            if (f.cardId) {
                const card = cardOf(f.cardId);
                if (card) {
                    const ym = F.invoiceFor(card, f.date);
                    rows.push([f.rec.kind === 'installment' ? '1ª parcela na fatura de' : 'Entra na fatura de', `${ymLabel(ym)} (vence ${shortDate(F.invoiceDates(card, ym).due)})`]);
                }
            }
        }
        el.hidden = !rows.length;
        el.innerHTML = rows.map(([k, v]) => `<div class="preview-row"><span>${k}</span><strong>${v}</strong></div>`).join('');
        $('fin-rec-hint').textContent = f.rec.kind === 'fixed'
            ? (f.cardId ? 'Gasto fixo no cartão (streaming, academia…): já entra nas próximas faturas e no limite previsto. Para encerrar, exclua "este e os próximos".' : 'Repete sem data para terminar, como aluguel ou salário. Para encerrar, exclua "este e os próximos".')
            : f.rec.kind === 'repeat' ? 'O valor informado se repete a cada vez, pelo número de vezes escolhido.'
            : f.rec.kind === 'installment' ? 'O valor total é dividido em parcelas mensais.'
            : '';
        $('fin-rec-hint').hidden = !$('fin-rec-hint').textContent;
    }

    function buildEntry(f) {
        const e = { id: uid(), createdAt: Date.now(), type: f.type, desc: f.desc, amount: f.amount, date: f.date, categoryId: f.categoryId, rec: { ...f.rec } };
        if (f.note) e.note = f.note;
        if (f.tags.length) e.tags = [...f.tags];
        if (f.cardId) e.cardId = f.cardId; else e.accountId = f.accountId;
        return e;
    }

    function applyBase(e, f) {
        e.type = f.type;
        e.desc = f.desc;
        e.amount = f.amount;
        e.categoryId = f.categoryId;
        e.rec = { ...f.rec };
        if (f.note) e.note = f.note; else delete e.note;
        if (f.tags.length) e.tags = [...f.tags]; else delete e.tags;
        delete e.cardId;
        delete e.accountId;
        if (f.cardId) e.cardId = f.cardId; else e.accountId = f.accountId;
        if (e.endIdx !== undefined && e.rec.kind === 'once') delete e.endIdx;
    }

    async function saveEntry(ev) {
        ev.preventDefault();
        const f = readEntryForm();
        const fail = (msg, id) => { toast(msg, { type: 'error' }); if (id) $(id).focus(); };
        if (!(f.amount > 0)) return fail('Informe um valor maior que zero.', 'fin-entry-amount');
        if (!f.date) return fail('Informe a data.', 'fin-entry-date');
        if (!f.categoryId) return fail('Escolha uma categoria.');
        if (f.cardId && !cardOf(f.cardId)) return fail('Escolha o cartão.');
        if (!f.cardId && !account(f.accountId)) return fail('Escolha a conta.');
        if (f.rec.kind === 'repeat' && !(f.rec.count >= 2 && f.rec.count <= 420)) return fail('Repetir: informe de 2 a 420 vezes.', 'fin-entry-count');
        if (f.rec.kind === 'installment' && !(f.rec.count >= 2 && f.rec.count <= 72)) return fail('Parcelar: informe de 2 a 72 parcelas.', 'fin-entry-installments');
        if (!f.desc) f.desc = categoryOf(f.categoryId, f.type).name;

        const entries = fin().entries;
        let message = 'Lançamento salvo.';
        if (!ui.entry) {
            entries.push(buildEntry(f));
            message = f.rec.kind === 'installment' ? `Compra lançada em ${f.rec.count}x.`
                : f.rec.kind === 'repeat' ? `Lançado ${f.rec.count} vezes.`
                : f.rec.kind === 'fixed' ? 'Lançamento fixo criado.' : 'Lançamento salvo.';
        } else {
            const e = entries.find(x => x.id === ui.entry.entryId);
            if (!e) { $('fin-entry-dialog').close(); return; }
            const idx = ui.entry.idx;
            const occDate = F.occurrenceDate(e, idx);
            const series = e.rec.kind === 'fixed' || e.rec.kind === 'repeat';

            if (!series) {
                // único ou parcelado: altera a compra inteira
                const sameKind = e.rec.kind === f.rec.kind;
                applyBase(e, f);
                e.date = f.date;
                if (!sameKind) { delete e.overrides; delete e.endIdx; }
            } else {
                const scope = await choiceDialog({
                    title: 'Alterar quais lançamentos?',
                    message: 'Este lançamento se repete.',
                    options: [
                        { value: 'one', label: 'Só este' },
                        { value: 'next', label: 'Este e os próximos' },
                        { value: 'all', label: 'Todos' }
                    ]
                });
                if (!scope) return;
                if (scope === 'one') {
                    e.overrides = e.overrides || {};
                    const ov = { ...(e.overrides[idx] || {}), amount: f.amount, desc: f.desc, categoryId: f.categoryId, note: f.note, tags: [...f.tags] };
                    if (!e.cardId && f.accountId) ov.accountId = f.accountId;
                    e.overrides[idx] = ov;
                    if (f.date !== occDate || f.rec.kind !== e.rec.kind) message = 'Salvo só neste. A data e a repetição mudam em "Todos".';
                } else if (scope === 'next' && idx > 0) {
                    const rest = buildEntry({ ...f, date: f.date });
                    if (rest.rec.kind === 'repeat' && e.rec.kind === 'repeat') rest.rec.count = Math.max(1, f.rec.count - idx);
                    if (rest.rec.kind === 'repeat' && rest.rec.count < 2) rest.rec = { kind: 'once' };
                    e.endIdx = idx - 1;
                    entries.push(rest);
                } else {
                    // todos (ou "este e os próximos" no primeiro): muda a série; a data desloca todas
                    const shift = F.daysBetween(occDate, f.date);
                    if (shift) e.date = F.addDaysKey(e.date, shift);
                    const kindChanged = e.rec.kind !== f.rec.kind;
                    applyBase(e, f);
                    if (e.overrides) {
                        // mantém só as exclusões; os valores novos valem para todos
                        Object.keys(e.overrides).forEach(k => {
                            if (e.overrides[k].deleted && !kindChanged) e.overrides[k] = { deleted: true };
                            else delete e.overrides[k];
                        });
                        if (!Object.keys(e.overrides).length) delete e.overrides;
                    }
                    if (kindChanged) delete e.endIdx;
                }
            }
            message = message === 'Lançamento salvo.' ? 'Lançamento atualizado.' : message;
        }
        $('fin-entry-dialog').close();
        markChanged(0);
        rerender();
        toast(message);
    }

    async function deleteEntry() {
        if (!ui.entry) return;
        const entries = fin().entries;
        const e = entries.find(x => x.id === ui.entry.entryId);
        if (!e) return;
        const idx = ui.entry.idx;
        const snapshot = JSON.stringify(entries);
        let scope = 'all';
        if (e.rec.kind !== 'once') {
            const inst = e.rec.kind === 'installment';
            scope = await choiceDialog({
                title: inst ? 'Excluir quais parcelas?' : 'Excluir quais lançamentos?',
                message: inst ? `Parcela ${idx + 1} de ${e.rec.count}.` : e.rec.kind === 'fixed' ? 'Para encerrar um gasto fixo, escolha "este e os próximos".' : `Lançamento ${idx + 1} de ${e.rec.count}.`,
                options: [
                    { value: 'one', label: inst ? 'Só esta parcela' : 'Só este' },
                    { value: 'next', label: inst ? 'Esta e as próximas' : 'Este e os próximos' },
                    { value: 'all', label: inst ? 'A compra inteira' : 'Todos', danger: true }
                ]
            });
            if (!scope) return;
        }
        if (scope === 'one') {
            e.overrides = e.overrides || {};
            e.overrides[idx] = { deleted: true };
        } else if (scope === 'next' && idx > 0) {
            e.endIdx = idx - 1;
        } else {
            fin().entries = entries.filter(x => x !== e);
        }
        // série sem nenhuma ocorrência restante: remove de vez
        if (fin().entries.includes(e) && !F.expandEntry(e, '0000-01-01', '9999-12-31').length && e.rec.kind !== 'fixed') {
            fin().entries = fin().entries.filter(x => x !== e);
        }
        $('fin-entry-dialog').close();
        markChanged();
        rerender();
        toast('Lançamento excluído.', {
            action: 'Desfazer',
            onAction: () => { fin().entries = JSON.parse(snapshot); markChanged(); rerender(); }
        });
    }

    // ═══════════════════════ Cartão (diálogo) ═══════════════════════
    function openCard(id = null) {
        const c = id ? cardOf(id) : null;
        ui.editingCard = c ? c.id : null;
        ui.cardColor = c?.color || F.CARD_COLORS[fin().cards.length % F.CARD_COLORS.length];
        $('fin-card-title').textContent = c ? 'Editar cartão' : 'Novo cartão de crédito';
        $('fin-card-name').value = c?.name || '';
        $('fin-card-limit').value = c ? moneyInput(c.limit) : '';
        $('fin-card-closing').value = c ? String(c.closingDay) : '';
        $('fin-card-due').value = c ? String(c.dueDay) : '';
        fillSelect('fin-card-account', fin().accounts, c?.accountId || F.WALLET_ID);
        renderCardColors();
        $('fin-card-delete').hidden = !c;
        $('fin-card-dialog').showModal();
        if (!c) setTimeout(() => $('fin-card-name').focus(), 50);
    }

    function renderCardColors() {
        $('fin-card-colors').innerHTML = F.CARD_COLORS.map(col => `
            <button type="button" class="color-swatch" data-color="${col}" style="--c:${col}" aria-pressed="${col === ui.cardColor}" aria-label="Cor"></button>`).join('');
    }

    function saveCard(ev) {
        ev.preventDefault();
        const name = $('fin-card-name').value.trim();
        const limit = parseDecimal($('fin-card-limit').value);
        const closingDay = parseInt($('fin-card-closing').value, 10);
        const dueDay = parseInt($('fin-card-due').value, 10);
        const fail = (msg, id) => { toast(msg, { type: 'error' }); if (id) $(id).focus(); };
        if (!name) return fail('Dê um nome ao cartão.', 'fin-card-name');
        if (!(limit > 0)) return fail('Informe o limite do cartão.', 'fin-card-limit');
        if (!(closingDay >= 1 && closingDay <= 31)) return fail('Dia de fechamento: de 1 a 31.', 'fin-card-closing');
        if (!(dueDay >= 1 && dueDay <= 31)) return fail('Dia de vencimento: de 1 a 31.', 'fin-card-due');
        if (closingDay === dueDay) return fail('O fechamento e o vencimento precisam ser em dias diferentes.', 'fin-card-due');

        const values = { name, limit, closingDay, dueDay, accountId: $('fin-card-account').value, color: ui.cardColor };
        const existing = ui.editingCard && cardOf(ui.editingCard);
        if (existing) Object.assign(existing, values);
        else {
            const c = { id: uid(), ...values };
            fin().cards.push(c);
            ui.cardId = c.id;
            ui.invoiceYm = null;
        }
        $('fin-card-dialog').close();
        markChanged(0);
        rerender();
        toast(existing ? 'Cartão atualizado.' : 'Cartão cadastrado.');
    }

    async function deleteCard() {
        const c = ui.editingCard && cardOf(ui.editingCard);
        if (!c) return;
        const count = fin().entries.filter(e => e.cardId === c.id).length;
        const ok = await confirmDialog({
            title: 'Excluir cartão?',
            message: count ? `"${c.name}", ${plural(count, 'a compra lançada', 'as compras lançadas')} nele e os pagamentos de fatura serão excluídos. Os pagamentos deixam de aparecer no saldo das contas.` : `"${c.name}" será excluído.`,
            confirmLabel: 'Excluir',
            danger: true
        });
        if (!ok) return;
        const snapshot = JSON.stringify({ cards: fin().cards, entries: fin().entries, payments: fin().payments });
        fin().cards = fin().cards.filter(x => x !== c);
        fin().entries = fin().entries.filter(e => e.cardId !== c.id);
        fin().payments = fin().payments.filter(p => p.cardId !== c.id);
        $('fin-card-dialog').close();
        markChanged();
        rerender();
        toast('Cartão excluído.', {
            action: 'Desfazer',
            onAction: () => { const s = JSON.parse(snapshot); fin().cards = s.cards; fin().entries = s.entries; fin().payments = s.payments; markChanged(); rerender(); }
        });
    }

    // ═══════════════════════ Pagar fatura (diálogo) ═══════════════════════
    function openPay(cardId, ym, paymentId = null) {
        const c = cardOf(cardId);
        if (!c) return;
        const pm = paymentId ? fin().payments.find(p => p.id === paymentId) : null;
        const inv = F.cardInvoice(data(), c, pm ? pm.ym : ym, todayKey());
        ui.pay = { cardId, ym: inv.ym, paymentId: pm?.id || null };
        $('fin-pay-title').textContent = pm ? 'Pagamento de fatura' : 'Pagar fatura';
        $('fin-pay-info').innerHTML = `<strong>${esc(c.name)}</strong> · fatura de ${ymLabel(inv.ym).toLowerCase()} · vence ${fullDate(inv.due)}<br>Total ${brl(inv.total)}${inv.paid > 0.005 ? ` · já pago ${brl(inv.paid)}` : ''}`;
        $('fin-pay-amount').value = moneyInput(pm ? pm.amount : inv.remaining);
        $('fin-pay-date').value = pm ? pm.date : todayKey();
        fillSelect('fin-pay-account', fin().accounts, pm ? pm.accountId : c.accountId);
        $('fin-pay-delete').hidden = !pm;
        $('fin-pay-submit').textContent = pm ? 'Salvar' : 'Confirmar pagamento';
        $('fin-pay-dialog').showModal();
    }

    function savePay(ev) {
        ev.preventDefault();
        const amount = parseDecimal($('fin-pay-amount').value);
        const date = $('fin-pay-date').value;
        if (!(amount > 0)) { toast('Informe o valor pago.', { type: 'error' }); $('fin-pay-amount').focus(); return; }
        if (!date) { toast('Informe a data do pagamento.', { type: 'error' }); return; }
        const values = { amount, date, accountId: $('fin-pay-account').value };
        const existing = ui.pay.paymentId && fin().payments.find(p => p.id === ui.pay.paymentId);
        if (existing) Object.assign(existing, values);
        else fin().payments.push({ id: uid(), cardId: ui.pay.cardId, ym: ui.pay.ym, ...values });
        $('fin-pay-dialog').close();
        markChanged(0);
        const c = cardOf(ui.pay.cardId);
        const inv = F.cardInvoice(data(), c, ui.pay.ym, todayKey());
        rerender();
        toast(existing ? 'Pagamento atualizado.'
            : inv.remaining > 0.005 ? `Pagamento registrado. Ainda faltam ${brl(inv.remaining)} desta fatura.`
            : 'Fatura paga! O limite foi liberado.');
    }

    function deletePay() {
        const pm = ui.pay?.paymentId && fin().payments.find(p => p.id === ui.pay.paymentId);
        if (!pm) return;
        const i = fin().payments.indexOf(pm);
        fin().payments.splice(i, 1);
        $('fin-pay-dialog').close();
        markChanged();
        rerender();
        toast('Pagamento desfeito.', { action: 'Desfazer', onAction: () => { fin().payments.splice(i, 0, pm); markChanged(); rerender(); } });
    }

    // ═══════════════════════ Transferência (diálogo) ═══════════════════════
    function openTransfer(id = null, amount = '') {
        if (!id && fin().accounts.length < 2) {
            toast('Crie outra conta para transferir entre elas.', { action: 'Nova conta', onAction: () => openAccount() });
            return;
        }
        const t = id ? fin().transfers.find(x => x.id === id) : null;
        ui.editingTransfer = t ? t.id : null;
        const accs = fin().accounts;
        $('fin-transfer-title').textContent = t ? 'Editar transferência' : 'Transferência entre contas';
        $('fin-transfer-amount').value = t ? moneyInput(t.amount) : amount;
        fillSelect('fin-transfer-from', accs, t ? t.fromId : F.WALLET_ID);
        fillSelect('fin-transfer-to', accs, t ? t.toId : (accs.find(a => a.id !== F.WALLET_ID)?.id));
        $('fin-transfer-date').value = t ? t.date : todayKey();
        $('fin-transfer-desc').value = t?.desc || '';
        $('fin-transfer-delete').hidden = !t;
        updateTransferPreview();
        $('fin-transfer-dialog').showModal();
        if (!t && !amount) setTimeout(() => $('fin-transfer-amount').focus(), 50);
    }

    function updateTransferPreview() {
        const el = $('fin-transfer-preview');
        const amount = parseDecimal($('fin-transfer-amount').value);
        const from = $('fin-transfer-from').value, to = $('fin-transfer-to').value;
        if (from && from === to) {
            el.hidden = false; el.classList.add('warn');
            el.innerHTML = '<div>Escolha contas diferentes.</div>';
            return;
        }
        el.classList.remove('warn');
        if (!(amount > 0)) { el.hidden = true; return; }
        // saldo hoje sem esta transferência (ao editar, desconta ela)
        const map = F.balances(data(), todayKey());
        const t = ui.editingTransfer && fin().transfers.find(x => x.id === ui.editingTransfer);
        if (t && t.date <= todayKey()) { map.set(t.fromId, map.get(t.fromId) + t.amount); map.set(t.toId, map.get(t.toId) - t.amount); }
        const rows = [
            [`${esc(account(from)?.name)} fica com`, brl((map.get(from) || 0) - amount)],
            [`${esc(account(to)?.name)} fica com`, brl((map.get(to) || 0) + amount)]
        ];
        el.hidden = false;
        el.innerHTML = rows.map(([k, v]) => `<div class="preview-row"><span>${k}</span><strong>${v}</strong></div>`).join('');
    }

    function saveTransfer(ev) {
        ev.preventDefault();
        const amount = parseDecimal($('fin-transfer-amount').value);
        const fromId = $('fin-transfer-from').value;
        const toId = $('fin-transfer-to').value;
        const date = $('fin-transfer-date').value;
        const fail = (msg, id) => { toast(msg, { type: 'error' }); if (id) $(id).focus(); };
        if (!(amount > 0)) return fail('Informe o valor.', 'fin-transfer-amount');
        if (fromId === toId) return fail('Escolha contas diferentes.', 'fin-transfer-to');
        if (!date) return fail('Informe a data.', 'fin-transfer-date');
        const values = { fromId, toId, amount, date, desc: $('fin-transfer-desc').value.trim() };
        const existing = ui.editingTransfer && fin().transfers.find(x => x.id === ui.editingTransfer);
        if (existing) Object.assign(existing, values);
        else fin().transfers.push({ id: uid(), ...values });
        $('fin-transfer-dialog').close();
        markChanged(0);
        rerender();
        toast(existing ? 'Transferência atualizada.' : `${brl(amount)} transferidos para ${account(toId)?.name}.`);
    }

    function deleteTransfer() {
        const t = ui.editingTransfer && fin().transfers.find(x => x.id === ui.editingTransfer);
        if (!t) return;
        const i = fin().transfers.indexOf(t);
        fin().transfers.splice(i, 1);
        $('fin-transfer-dialog').close();
        markChanged();
        rerender();
        toast('Transferência excluída.', { action: 'Desfazer', onAction: () => { fin().transfers.splice(i, 0, t); markChanged(); rerender(); } });
    }

    // ═══════════════════════ Conta (diálogo) ═══════════════════════
    function openAccount(id = null) {
        const a = id ? account(id) : null;
        ui.editingAccount = a ? a.id : null;
        $('fin-account-title').textContent = a ? 'Editar conta' : 'Nova conta';
        $('fin-account-name').value = a?.name || '';
        $('fin-account-kind').innerHTML = Object.entries(F.ACCOUNT_KINDS).map(([k, v]) => `<option value="${k}"${(a?.kind || 'corrente') === k ? ' selected' : ''}>${v}</option>`).join('');
        $('fin-account-initial').value = a ? moneyInput(Math.abs(a.initial)) : '';
        $('fin-account-negative').checked = !!a && a.initial < 0;
        $('fin-account-delete').hidden = !a || a.id === F.WALLET_ID;
        $('fin-account-dialog').showModal();
        if (!a) setTimeout(() => $('fin-account-name').focus(), 50);
    }

    function saveAccount(ev) {
        ev.preventDefault();
        const name = $('fin-account-name').value.trim();
        if (!name) { toast('Dê um nome à conta.', { type: 'error' }); $('fin-account-name').focus(); return; }
        const initial = parseDecimal($('fin-account-initial').value) * ($('fin-account-negative').checked ? -1 : 1);
        const values = { name, kind: $('fin-account-kind').value, initial };
        const existing = ui.editingAccount && account(ui.editingAccount);
        if (existing) Object.assign(existing, values);
        else fin().accounts.push({ id: uid(), ...values });
        $('fin-account-dialog').close();
        markChanged(0);
        rerender();
        toast(existing ? 'Conta atualizada.' : 'Conta criada.');
    }

    async function deleteAccount() {
        const a = ui.editingAccount && account(ui.editingAccount);
        if (!a || a.id === F.WALLET_ID) return;
        if (F.usage(data(), { accountId: a.id })) {
            toast('Essa conta tem lançamentos, transferências, pagamentos de fatura, cartões ou recebe os ganhos dos apps. Mude ou exclua esses itens antes.', { type: 'error', duration: 6000 });
            return;
        }
        const ok = await confirmDialog({ title: 'Excluir conta?', message: `"${a.name}" será excluída.`, confirmLabel: 'Excluir', danger: true });
        if (!ok) return;
        const i = fin().accounts.indexOf(a);
        fin().accounts.splice(i, 1);
        $('fin-account-dialog').close();
        markChanged();
        rerender();
        toast('Conta excluída.', { action: 'Desfazer', onAction: () => { fin().accounts.splice(i, 0, a); markChanged(); rerender(); } });
    }

    // ── Categorias ──
    function addCategory(ev) {
        ev.preventDefault();
        const input = $('fin-cat-name');
        const name = input.value.trim().replace(/\s+/g, ' ');
        if (!name) return;
        if (fin().categories.some(c => c.type === ui.catType && c.name.toLowerCase() === name.toLowerCase())) {
            toast('Essa categoria já existe.', { type: 'error' });
            return;
        }
        const used = fin().categories.filter(c => c.type === ui.catType).length;
        fin().categories.push({ id: uid(), name, type: ui.catType, color: F.CATEGORY_COLORS[used % F.CATEGORY_COLORS.length] });
        markChanged();
        rerender();
        toast('Categoria criada.');
        setTimeout(() => $('fin-cat-name')?.focus(), 30);
    }

    async function deleteCategory(id) {
        const c = fin().categories.find(x => x.id === id);
        if (!c || F.isSystemCategory(id)) return;
        const n = F.usage(data(), { categoryId: id });
        if (n) {
            const ok = await confirmDialog({
                title: 'Excluir categoria?',
                message: `${plural(n, 'lançamento usa', 'lançamentos usam')} "${c.name}". Eles passam para "Outros".`,
                confirmLabel: 'Excluir', danger: true
            });
            if (!ok) return;
        }
        const snapshot = JSON.stringify({ categories: fin().categories, entries: fin().entries });
        const fallback = F.fallbackCategoryId(c.type);
        fin().entries.forEach(e => {
            if (e.categoryId === id) e.categoryId = fallback;
            Object.values(e.overrides || {}).forEach(o => { if (o.categoryId === id) o.categoryId = fallback; });
        });
        fin().categories = fin().categories.filter(x => x !== c);
        markChanged();
        rerender();
        toast(`"${c.name}" excluída.`, {
            action: 'Desfazer',
            onAction: () => { const s = JSON.parse(snapshot); fin().categories = s.categories; fin().entries = s.entries; markChanged(); rerender(); }
        });
    }

    // ═══════════════════════ Primeiro acesso ═══════════════════════
    const needsOnboarding = () => !fin().setupDone;

    function openOnboarding() {
        ui.onboardMode = null;
        ui.onboardSince = 'today';
        const days = data().history.length;
        $('fin-onboard-history').hidden = days === 0;
        $('fin-onboard-initial').value = '';
        renderOnboarding();
        $('fin-onboard-dialog').showModal();
    }

    function renderOnboarding() {
        document.querySelectorAll('#fin-onboard-mode [data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === ui.onboardMode)));
        document.querySelectorAll('#fin-onboard-since .seg-btn').forEach(b => {
            const on = b.dataset.since === ui.onboardSince;
            b.classList.toggle('active', on);
            b.setAttribute('aria-selected', String(on));
        });
        $('fin-onboard-start').disabled = !ui.onboardMode;
    }

    function finishOnboarding(ev) {
        ev.preventDefault();
        if (!ui.onboardMode) { toast('Escolha se os ganhos entram pelo líquido ou pelo bruto.', { type: 'error' }); return; }
        const tk = todayKey();
        const since = ui.onboardSince === 'all' ? null : ui.onboardSince === 'month' ? `${F.ymOf(tk)}-01` : tk;
        fin().integration = { mode: ui.onboardMode, accountId: fin().integration.accountId || F.WALLET_ID, since };
        const wallet = account(F.WALLET_ID);
        const initial = parseDecimal($('fin-onboard-initial').value);
        if (wallet && initial > 0) wallet.initial = initial;
        fin().setupDone = true;
        $('fin-onboard-dialog').close();
        markChanged(0);
        rerender();
        toast('Tudo pronto! Seus ganhos dos apps já entram aqui.');
    }

    // ── Integração ──
    function setIntegration(patch) {
        Object.assign(fin().integration, patch);
        markChanged();
        rerender();
    }

    /** Texto para a tela Início do Na Pista: quanto do dia vai para a gestão. */
    function dayHint(dateKey) {
        if (!data()?.finance?.setupDone) return '';
        const o = F.napistaOccurrences(data(), dateKey, dateKey)[0];
        const integ = fin().integration;
        if (integ.since && dateKey < integ.since) return '';
        if (!o) return '';
        const acc = account(integ.accountId)?.name || 'Carteira';
        return o.type === 'income'
            ? `Na Gestão na Pista: + ${brl(o.amount)} (${integ.mode === 'gross' ? 'bruto' : 'líquido'}) na ${acc}.`
            : `Na Gestão na Pista: − ${brl(o.amount)} de custos do dia na ${acc}.`;
    }

    function openOccurrence(id) {
        const o = ui.occMap.get(id);
        if (!o) return;
        if (o.forecast) {
            toast('Previsão pela meta líquida do dia. Quando você lançar o dia no Na Pista, entra o valor real.', {
                action: 'Lançar dia', duration: 6000, onAction: () => ctx.openNaPistaDay(o.date)
            });
            return;
        }
        if (o.virtual) {
            const mode = fin().integration.mode === 'gross' ? 'bruto' : 'líquido';
            toast(`Valor ${mode} do dia lançado no Na Pista${o.apps?.length ? ` (${o.apps.join(', ')})` : ''}.`, {
                action: 'Abrir dia', duration: 6000, onAction: () => ctx.openNaPistaDay(o.date)
            });
            return;
        }
        if (o.kind === 'transfer') return openTransfer(o.transfer.id);
        if (o.kind === 'payment') return openPay(o.card.id, o.payment.ym, o.payment.id);
        openEntry({ occ: o });
    }

    // ═══════════════════════ Eventos ═══════════════════════
    function bind() {
        const screens = ['fin-home-body', 'fin-entries-body', 'fin-cards-body', 'fin-accounts-body'];
        $('fin-home-body').addEventListener('change', (e) => {
            if (e.target.id !== 'fin-forecast-toggle') return;
            fin().forecast = e.target.checked;
            markChanged();
            rerender();
            toast(e.target.checked ? 'Previsão com metas ligada.' : 'Mostrando só os lançados.');
        });
        screens.forEach(id => $(id).addEventListener('click', (e) => {
            const t = e.target;
            const month = t.closest('[data-fin-month]');
            if (month) {
                const d = Number(month.dataset.finMonth);
                ui.month = d === 0 ? F.ymOf(todayKey()) : F.ymShift(ui.month, d);
                return rerender();
            }
            const occ = t.closest('[data-occ]');
            if (occ) return openOccurrence(occ.dataset.occ);
            if (t.closest('[data-open-filter]')) return openFilter();
            if (t.closest('[data-clear-filter]')) { ui.catFilter = []; ui.tagFilter = []; return rerender(); }
            const unCat = t.closest('[data-unfilter-cat]');
            if (unCat) { ui.catFilter = ui.catFilter.filter(x => x !== unCat.dataset.unfilterCat); return rerender(); }
            const unTag = t.closest('[data-unfilter-tag]');
            if (unTag) { ui.tagFilter = ui.tagFilter.filter(x => !sameTag(x, unTag.dataset.unfilterTag)); return rerender(); }
            const filter = t.closest('[data-fin-filter]');
            if (filter) { ui.filter = filter.dataset.finFilter; return rerender(); }
            const go = t.closest('[data-goto]');
            if (go) return ctx.showScreen(go.dataset.goto);
            const goFilter = t.closest('[data-goto-filter]');
            if (goFilter) { ui.filter = goFilter.dataset.gotoFilter; return ctx.showScreen('fin-entries-screen'); }
            const pay = t.closest('[data-pay]');
            if (pay) return openPay(pay.dataset.pay, pay.dataset.payYm);
            if (t.closest('[data-new-transfer]')) return openTransfer();
            const goCard = t.closest('[data-goto-card]');
            if (goCard) { ui.cardId = goCard.dataset.gotoCard; ui.invoiceYm = goCard.dataset.gotoInvoice || null; return ctx.showScreen('fin-cards-screen'); }
            const sel = t.closest('[data-card-select]');
            if (sel) { ui.cardId = sel.dataset.cardSelect; ui.invoiceYm = null; return rerender(); }
            const inv = t.closest('[data-invoice]');
            if (inv) { ui.invoiceYm = inv.dataset.invoice; rerender(); $('fin-cards-body').querySelector('.invoice-total')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
            const step = t.closest('[data-invoice-step]');
            if (step) { ui.invoiceYm = F.ymShift(ui.invoiceYm, Number(step.dataset.invoiceStep)); return rerender(); }
            if (t.closest('[data-new-card]')) return openCard();
            const editCard = t.closest('[data-edit-card]');
            if (editCard) return openCard(editCard.dataset.editCard);
            const cardEntry = t.closest('[data-new-card-entry]');
            if (cardEntry) return openEntry({ type: 'card', cardId: cardEntry.dataset.newCardEntry });
            if (t.closest('[data-new-account]')) return openAccount();
            const editAcc = t.closest('[data-edit-account]');
            if (editAcc) return openAccount(editAcc.dataset.editAccount);
            const integ = t.closest('[data-integ-mode]');
            if (integ && integ.dataset.integMode !== fin().integration.mode) {
                setIntegration({ mode: integ.dataset.integMode });
                return toast(integ.dataset.integMode === 'gross' ? 'Os ganhos dos apps agora entram pelo bruto.' : 'Os ganhos dos apps agora entram pelo líquido.');
            }
            const catType = t.closest('[data-cat-type]');
            if (catType) { ui.catType = catType.dataset.catType; return rerender(); }
            const delCat = t.closest('[data-del-cat]');
            if (delCat) return deleteCategory(delCat.dataset.delCat);
        }));

        document.querySelector('[data-new-card-head]').addEventListener('click', () => openCard());

        $('fin-accounts-body').addEventListener('change', (e) => {
            if (e.target.id === 'fin-integ-account') setIntegration({ accountId: e.target.value });
            if (e.target.id === 'fin-integ-since') setIntegration({ since: e.target.value || null });
        });
        $('fin-accounts-body').addEventListener('submit', (e) => {
            if (e.target.id === 'fin-cat-form') addCategory(e);
        });

        // Botão "+" (lançamento rápido): no cartão, já abre como compra no cartão
        $('fin-fab').addEventListener('click', () => {
            const active = document.querySelector('.screen.active')?.id;
            if (active === 'fin-cards-screen' && fin().cards.length) openEntry({ type: 'card', cardId: ui.cardId });
            else openEntry({ type: ui.filter === 'income' ? 'income' : 'expense' });
        });

        // Diálogo de lançamento
        document.querySelectorAll('#fin-entry-type .seg-btn').forEach(b => b.addEventListener('click', () => {
            if (b.dataset.entryType === 'transfer') {
                if (ui.entry) return; // um lançamento existente não vira transferência
                const amount = $('fin-entry-amount').value;
                $('fin-entry-dialog').close();
                openTransfer(null, amount);
                return;
            }
            if (b.dataset.entryType === 'card' && !fin().cards.length) {
                toast('Cadastre um cartão de crédito primeiro.', { action: 'Cadastrar', onAction: () => { $('fin-entry-dialog').close(); openCard(); } });
                return;
            }
            ui.entryType = b.dataset.entryType;
            renderEntryType();
        }));
        document.querySelectorAll('#fin-entry-rec .seg-btn').forEach(b => b.addEventListener('click', () => {
            ui.entryRec = b.dataset.rec;
            renderEntryRec();
            if (ui.entryRec === 'repeat' && !$('fin-entry-count').value) $('fin-entry-count').value = '12';
            if (ui.entryRec === 'installment' && !$('fin-entry-installments').value) $('fin-entry-installments').value = '2';
            updateEntryPreview();
        }));
        $('fin-entry-cats').addEventListener('click', (e) => {
            const chip = e.target.closest('[data-cat]');
            if (!chip) return;
            ui.entryCat = chip.dataset.cat;
            $('fin-entry-cats').querySelectorAll('[data-cat]').forEach(c => c.setAttribute('aria-pressed', String(c === chip)));
        });
        $('fin-entry-tags').addEventListener('input', renderTagSuggest);
        $('fin-entry-tag-suggest').addEventListener('click', (e) => {
            const chip = e.target.closest('[data-add-tag]');
            if (!chip) return;
            const input = $('fin-entry-tags');
            input.value = [...F.parseTags(input.value), chip.dataset.addTag].join(', ');
            renderTagSuggest();
        });

        // Filtros
        $('fin-filter-dialog').addEventListener('click', (e) => {
            const cat = e.target.closest('[data-filter-cat]');
            if (cat) { ui.catFilter = toggleIn(ui.catFilter, cat.dataset.filterCat); cat.setAttribute('aria-pressed', String(ui.catFilter.includes(cat.dataset.filterCat))); }
            const tag = e.target.closest('[data-filter-tag]');
            if (tag) { ui.tagFilter = toggleIn(ui.tagFilter, tag.dataset.filterTag, sameTag); tag.setAttribute('aria-pressed', String(F.hasTag(ui.tagFilter, tag.dataset.filterTag))); }
        });
        $('fin-filter-clear').addEventListener('click', () => { ui.catFilter = []; ui.tagFilter = []; renderFilter(); });
        $('fin-filter-dialog').addEventListener('close', rerender);
        $('fin-entry-form').addEventListener('input', updateEntryPreview);
        $('fin-entry-form').addEventListener('change', updateEntryPreview);
        $('fin-entry-form').addEventListener('submit', saveEntry);
        $('fin-entry-delete').addEventListener('click', deleteEntry);

        // Cartão
        $('fin-card-form').addEventListener('submit', saveCard);
        $('fin-card-delete').addEventListener('click', deleteCard);
        $('fin-card-colors').addEventListener('click', (e) => {
            const sw = e.target.closest('[data-color]');
            if (!sw) return;
            ui.cardColor = sw.dataset.color;
            renderCardColors();
        });
        ['fin-card-closing', 'fin-card-due'].forEach(id => $(id).addEventListener('input', (e) => {
            const v = parseInt(e.target.value, 10);
            if (v > 31) e.target.value = '31';
        }));

        // Pagar fatura
        $('fin-pay-form').addEventListener('submit', savePay);
        $('fin-pay-delete').addEventListener('click', deletePay);

        // Transferência
        $('fin-transfer-form').addEventListener('submit', saveTransfer);
        $('fin-transfer-delete').addEventListener('click', deleteTransfer);
        $('fin-transfer-form').addEventListener('input', updateTransferPreview);
        $('fin-transfer-form').addEventListener('change', updateTransferPreview);
        $('fin-transfer-swap').addEventListener('click', () => {
            const a = $('fin-transfer-from').value;
            $('fin-transfer-from').value = $('fin-transfer-to').value;
            $('fin-transfer-to').value = a;
            updateTransferPreview();
        });

        // Conta
        $('fin-account-form').addEventListener('submit', saveAccount);
        $('fin-account-delete').addEventListener('click', deleteAccount);

        // Primeiro acesso
        $('fin-onboard-mode').addEventListener('click', (e) => {
            const b = e.target.closest('[data-mode]');
            if (!b) return;
            ui.onboardMode = b.dataset.mode;
            renderOnboarding();
        });
        document.querySelectorAll('#fin-onboard-since .seg-btn').forEach(b => b.addEventListener('click', () => {
            ui.onboardSince = b.dataset.since;
            renderOnboarding();
        }));
        $('fin-onboard-form').addEventListener('submit', finishOnboarding);
        // fechou sem escolher: volta para o Na Pista
        $('fin-onboard-dialog').addEventListener('close', () => {
            if (needsOnboarding()) ctx.leave();
        });
    }

    // ═══════════════════════ Calculadora do campo de valor ═══════════════════════
    // Conta simples (+ − × ÷, com vírgula decimal) e o resultado vai direto para o campo.
    const calc = { expr: '', target: null };
    const CALC_OPS = ['+', '−', '×', '÷'];
    const calcNum = (n) => n.toLocaleString('pt-BR', { maximumFractionDigits: 2, useGrouping: false });

    /** Resultado da expressão (× e ÷ antes de + e −); null se não der para calcular. */
    function calcEval(expr) {
        const tokens = expr.split(/([+−×÷])/).filter(t => t !== '');
        if (CALC_OPS.includes(tokens[tokens.length - 1])) tokens.pop();
        if (tokens[0] === '−') tokens.unshift('0');
        if (!tokens.length) return 0;
        const nums = [], ops = [];
        for (const t of tokens) {
            if (CALC_OPS.includes(t)) ops.push(t);
            else nums.push(parseFloat(t.replace(',', '.')) || 0);
        }
        // primeiro × e ÷
        const n2 = [nums[0]], o2 = [];
        for (let i = 0; i < ops.length; i++) {
            const b = nums[i + 1];
            if (ops[i] === '×') n2[n2.length - 1] *= b;
            else if (ops[i] === '÷') { if (b === 0) return null; n2[n2.length - 1] /= b; }
            else { o2.push(ops[i]); n2.push(b); }
        }
        let r = n2[0];
        o2.forEach((op, i) => { r = op === '+' ? r + n2[i + 1] : r - n2[i + 1]; });
        return Number.isFinite(r) ? Math.round(r * 100) / 100 : null;
    }

    function renderCalc() {
        const r = calcEval(calc.expr);
        $('calc-expr').textContent = calc.expr ? calc.expr.replace(/([+−×÷])/g, ' $1 ') : '0';
        const res = $('calc-result');
        res.classList.toggle('neg', r === null || r < 0);
        res.textContent = r === null ? 'Não dá para dividir por zero' : `= ${brl(r)}`;
        $('calc-use').textContent = r !== null && r > 0 ? `Usar ${brl(r)}` : 'Usar valor';
        $('calc-use').disabled = !(r > 0);
    }

    function calcKey(k) {
        const e = calc.expr;
        const last = e.slice(-1);
        const current = e.split(/[+−×÷]/).pop(); // número sendo digitado
        if (k === 'clear') calc.expr = '';
        else if (k === 'back') calc.expr = e.slice(0, -1);
        else if (k === 'eq') { const r = calcEval(e); if (r !== null) calc.expr = r === 0 ? '' : calcNum(r); }
        else if (CALC_OPS.includes(k)) {
            if (!e) { if (k === '−') calc.expr = '−'; }
            else if (CALC_OPS.includes(last)) calc.expr = e.length > 1 ? e.slice(0, -1) + k : e;
            else calc.expr = (last === ',' ? e.slice(0, -1) : e) + k;
        } else if (k === ',') {
            if (!current.includes(',')) calc.expr = e + (current === '' || CALC_OPS.includes(last) ? '0,' : ',');
        } else {
            // dígitos: limite de 2 casas decimais e 10 dígitos por número
            const dec = current.includes(',') ? current.split(',')[1].length : -1;
            const digits = current.replace(/\D/g, '').length;
            if (dec + k.length > 2 && dec >= 0) return;
            if (digits + k.length > 10) return;
            if (current === '0' && !current.includes(',')) calc.expr = e.slice(0, -1) + k.replace(/^0+(?=\d)/, '');
            else if (k === '00' && current === '') calc.expr = e + '0';
            else calc.expr = e + k;
        }
        renderCalc();
    }

    function openCalc(inputId) {
        calc.target = inputId;
        const v = parseDecimal($(inputId).value);
        calc.expr = v > 0 ? calcNum(v) : '';
        renderCalc();
        $('calc-dialog').showModal();
    }

    function useCalc() {
        const r = calcEval(calc.expr);
        if (!(r > 0)) { toast('O resultado precisa ser maior que zero.', { type: 'error' }); return; }
        if (r > 9999999.99) { toast('Valor muito alto.', { type: 'error' }); return; }
        const input = $(calc.target);
        input.value = moneyInput(r);
        input.dispatchEvent(new Event('input', { bubbles: true })); // atualiza máscara e prévias
        $('calc-dialog').close();
    }

    function bindCalc() {
        document.addEventListener('click', (e) => {
            const b = e.target.closest('[data-calc]');
            if (b) openCalc(b.dataset.calc);
        });
        $('calc-keys').addEventListener('click', (e) => {
            const k = e.target.closest('[data-key]');
            if (k) calcKey(k.dataset.key);
        });
        $('calc-use').addEventListener('click', useCalc);
        // teclado físico (computador)
        $('calc-dialog').addEventListener('keydown', (e) => {
            const map = { '*': '×', 'x': '×', 'X': '×', '/': '÷', '-': '−', '+': '+', '.': ',', ',': ',', 'Backspace': 'back', 'Delete': 'clear', '=': 'eq' };
            if (e.key === 'Enter') { e.preventDefault(); useCalc(); return; }
            const k = /^\d$/.test(e.key) ? e.key : map[e.key];
            if (!k) return;
            e.preventDefault();
            calcKey(k);
        });
    }

    return {
        render,
        rerender,
        bind: () => { bind(); bindCalc(); },
        dayHint,
        needsOnboarding,
        openOnboarding,
        resetMonth: () => { ui.month = F.ymOf(todayKey()); }
    };
}
