import { initAuth, isAuthReady, login, getToken, logout, hasValidToken, invalidateToken, setAccountHint, getAccountHint } from './auth.js?v=2.7.1';
import { findDataFile, readData, saveData, deleteData, getUserEmail } from './drive.js?v=2.7.1';
import * as L from './logic.js?v=2.7.1';
import * as P from './plans.js?v=2.7.1';
import * as F from './finance.js?v=2.7.1';
import { createGestao, GESTAO_SCREENS } from './gestao.js?v=2.7.1';

// ═══════════════════════ Constantes ═══════════════════════
const PRESET_PLATFORMS = ['Uber', '99', 'InDrive', 'Particular', 'iFood', 'Shopee', 'Mercado Livre', 'Lalamove'];
const EXPENSE_SUGGESTIONS = ['Almoço', 'Lanche', 'Café', 'Água', 'Pedágio', 'Estacionamento', 'Lavagem', 'Manutenção'];
const PLATFORM_COLORS = ['#10b981', '#60a5fa', '#f59e0b', '#a78bfa', '#f472b6', '#22d3ee', '#fb7185', '#84cc16'];
const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const WEEKDAYS_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const NAPISTA_SCREENS = ['dashboard-screen', 'reports-screen', 'goals-screen', 'profile-screen'];
const MAIN_SCREENS = [...NAPISTA_SCREENS, ...GESTAO_SCREENS];
const MODE_KEY = 'napista_mode';        // último app aberto neste aparelho: 'napista' | 'gestao'
const CACHE_KEY = 'napista_cache';     // cópia local dos dados (abre o app sem precisar de login)
const OLD_PENDING_KEY = 'napista_pending';
const PULL_INTERVAL_MS = 5 * 60 * 1000;

const ICON_TRASH = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/></svg>';

// ═══════════════════════ Estado ═══════════════════════
const state = {
    data: null,
    fileId: null,
    scope: 'day',
    anchor: L.startOfDay(new Date()),     // data de referência do período exibido
    dayAnchor: L.startOfDay(new Date()),  // último dia escolhido (para voltar ao escopo "dia")
    reportTab: 'days',
    reportKey: null,
    reportLimit: 5,                       // itens visíveis na lista de relatórios
    range: null,
    setupPlatforms: [],
    setupWeekdays: [],
    setupOptions: [],
    editingExpense: null,
    reportExpenses: [],
    editingGoal: null,
    goalWeekdays: [],
    plansPeriod: 'mensal',
    plansHighlight: null
};

// ═══════════════════════ Utilidades ═══════════════════════
const $ = (id) => document.getElementById(id);
const brl = (v) => (Number.isFinite(v) ? v : 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmt = (v, digits = 1) => (Number.isFinite(v) ? v : 0).toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const todayDate = () => L.startOfDay(new Date());
const settings = () => state.data.settings;
const pad2 = (n) => String(n).padStart(2, '0');
const shortDate = (d) => `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}`;

function parseDecimal(v) {
    if (typeof v === 'number') return v;
    const s = String(v ?? '').trim();
    if (!s) return 0;
    const normalized = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
    const n = parseFloat(normalized);
    return Number.isFinite(n) ? n : 0;
}

const moneyInput = (v) => (v > 0 ? v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');
const decimalInput = (v) => (v > 0 ? String(Math.round(v * 100) / 100).replace('.', ',') : '');

function maskMoney(input) {
    const digits = input.value.replace(/\D/g, '').replace(/^0+/, '').slice(0, 9);
    input.value = digits ? (parseInt(digits, 10) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '';
}

function maskDecimal(input) {
    let v = input.value.replace(/[^\d.,]/g, '').replace('.', ',');
    const i = v.indexOf(',');
    if (i !== -1) v = v.slice(0, i + 1) + v.slice(i + 1).replace(/,/g, '').slice(0, 2);
    input.value = v.slice(0, 8);
}

function platformColor(name) {
    const list = state.data?.settings?.plataformas || [];
    let idx = list.indexOf(name);
    if (idx === -1) idx = [...name].reduce((a, c) => a + c.charCodeAt(0), 0);
    return PLATFORM_COLORS[idx % PLATFORM_COLORS.length];
}

function findDay(key) {
    return state.data.history.find(h => h.date === key);
}

function getOrCreateDay(key) {
    let day = findDay(key);
    if (!day) {
        day = { date: key, earnings: {}, km: 0, expenses: 0, detailedExpenses: [] };
        state.data.history.push(day);
        state.data.history.sort((a, b) => a.date.localeCompare(b.date));
    }
    return day;
}

function pruneDay(day) {
    const empty = !Object.keys(day.earnings || {}).length && !L.num(day.km)
        && !day.consumoL && !day.precoL && !(day.detailedExpenses || []).length;
    if (empty) state.data.history = state.data.history.filter(h => h !== day);
}

function normalizeData(raw) {
    const data = raw && typeof raw === 'object' ? raw : {};
    data.settings = { ...L.defaultSettings(), ...(data.settings || {}) };
    if (!Array.isArray(data.settings.plataformas)) data.settings.plataformas = [];
    // perfis antigos guardavam "dias de trabalho no mês": converte para dias da semana
    const wd = Array.isArray(data.settings.diasSemana) ? data.settings.diasSemana.filter(d => Number.isInteger(d) && d >= 0 && d <= 6) : [];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data.settings.dataInicio || '')) data.settings.dataInicio = null;
    data.settings.diasSemana = wd.length ? [...new Set(wd)] : (L.num(data.settings.diasTrabalhoMes) > 0 ? L.legacyWorkWeekdays(data.settings) : []);

    const seen = new Set();
    data.history = (Array.isArray(data.history) ? data.history : []).filter(d => {
        if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d.date) || seen.has(d.date)) return false;
        seen.add(d.date);
        return true;
    });

    data.history.forEach(d => {
        if (!d.earnings || typeof d.earnings !== 'object') d.earnings = {};
        if (!Array.isArray(d.detailedExpenses)) {
            d.detailedExpenses = L.num(d.expenses) > 0 ? [{ desc: 'Gastos gerais', val: L.num(d.expenses) }] : [];
        }
        d.expenses = L.dayExpenses(d);
    });
    data.history.sort((a, b) => a.date.localeCompare(b.date));

    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    data.goals = (Array.isArray(data.goals) ? data.goals : []).filter(g =>
        g && g.id && L.num(g.amount) > 0 && dateRe.test(g.startDate) && dateRe.test(g.deadline));
    data.goals.forEach(g => {
        if (!Array.isArray(g.weekdays) || !g.weekdays.length) g.weekdays = [...L.ALL_WEEKDAYS];
        if (!Number.isFinite(g.priority)) delete g.priority;
        delete g.showOnHome; // opção antiga "mostrar no início", não usada mais
    });
    data.finance = F.normalizeFinance(data.finance);
    return data;
}

// ═══════════════════════ Feedback (toast / confirm) ═══════════════════════
let toastTimer;
function toast(message, { type = 'info', action, onAction, duration = 3500 } = {}) {
    const el = $('toast');
    const btn = $('toast-action');
    $('toast-msg').textContent = message;
    el.dataset.type = type;
    btn.hidden = !action;
    btn.textContent = action || '';
    btn.onclick = () => { el.classList.remove('show'); onAction?.(); };
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), duration);
}

/** Pergunta com várias opções (ex.: "Só este", "Todos"). Resolve o `value` escolhido ou null. */
function choiceDialog({ title, message = '', options }) {
    const dlg = $('choice-dialog');
    $('choice-title').textContent = title;
    $('choice-message').textContent = message;
    $('choice-message').hidden = !message;
    const box = $('choice-options');
    box.innerHTML = options.map((o, i) => `<button type="button" class="btn ${o.danger ? 'btn-danger-ghost' : i === 0 ? 'btn-primary' : 'btn-ghost'}" data-choice="${i}">${esc(o.label)}</button>`).join('');
    return new Promise(resolve => {
        let result = null;
        box.onclick = (e) => {
            const b = e.target.closest('[data-choice]');
            if (!b) return;
            result = options[Number(b.dataset.choice)].value;
            dlg.close();
        };
        $('choice-cancel').onclick = () => dlg.close();
        dlg.onclose = () => resolve(result);
        dlg.showModal();
    });
}

function confirmDialog({ title, message, confirmLabel = 'Confirmar', danger = false }) {
    const dlg = $('confirm-dialog');
    $('confirm-title').textContent = title;
    $('confirm-message').textContent = message;
    const ok = $('confirm-ok');
    ok.textContent = confirmLabel;
    ok.className = `btn ${danger ? 'btn-danger' : 'btn-primary'}`;
    return new Promise(resolve => {
        const done = (result) => { dlg.close(); resolve(result); };
        ok.onclick = () => done(true);
        $('confirm-cancel').onclick = () => done(false);
        dlg.oncancel = () => resolve(false);
        dlg.showModal();
    });
}

// ═══════════════════════ Sincronização com o Drive ═══════════════════════
// Os dados ficam sempre numa cópia local (localStorage). O app abre direto
// dessa cópia, sem pedir login; o Google Drive é sincronizado quando há um
// token válido. O token do Google dura só 1 hora e só pode ser renovado com
// um toque do usuário (popup), então a renovação acontece apenas quando é
// preciso sincronizar — e, com o e-mail salvo como dica, o popup fecha sozinho.
let changeVersion = 0;
let savedVersion = 0;
let saveTimer = null;
let inflight = null;
let saveAgain = false;
let authToastShown = false;
let syncing = null;
let lastPull = 0;
let autoRenewTried = false;

const SYNC_LABELS = {
    saved: 'Salvo',
    pending: 'Alterado',
    saving: 'Salvando…',
    error: 'Não salvo · tentar',
    auth: 'Sincronizar',
    stale: 'Sincronizar',
    offline: 'Offline'
};

function setSync(status) {
    const pill = $('sync-pill');
    pill.dataset.state = status;
    $('sync-label').textContent = SYNC_LABELS[status];
    pill.title = status === 'error' ? 'Toque para tentar salvar novamente'
        : status === 'auth' ? 'Alterações salvas no aparelho. Toque para enviar ao Google Drive.'
        : status === 'stale' ? 'Mostrando os dados salvos no aparelho. Toque para buscar a versão do Google Drive.' : '';
    if (status === 'auth' && !authToastShown) {
        authToastShown = true;
        toast('Alterações guardadas no aparelho. Toque em "Sincronizar" para enviar ao Drive.', {
            action: 'Sincronizar', duration: 8000, onAction: () => syncNow()
        });
    }
    if (status === 'saved') authToastShown = false;
}

const hasUnsaved = () => changeVersion !== savedVersion;
const needsSync = () => hasUnsaved() || !lastPull;

function writeCache() {
    if (!state.data) return;
    try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({
            fileId: state.fileId, dirty: hasUnsaved(), updatedAt: Date.now(), data: state.data
        }));
    } catch { /* sem espaço / modo privado */ }
}

function readCache() {
    try {
        const cache = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
        if (cache?.data) return cache;
        // formato antigo: só existia cópia local de alterações não salvas
        const old = JSON.parse(localStorage.getItem(OLD_PENDING_KEY) || 'null');
        if (old?.data) return { fileId: old.fileId, dirty: true, data: old.data };
    } catch { /* ignora */ }
    return null;
}

function clearCache() {
    try {
        localStorage.removeItem(CACHE_KEY);
        localStorage.removeItem(OLD_PENDING_KEY);
    } catch { /* ignora */ }
}

/** Registra uma alteração: guarda cópia local e agenda envio ao Drive. */
function markChanged(delay = 1500) {
    changeVersion++;
    writeCache();
    setSync('pending');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, delay);
}

/**
 * Envia os dados ao Drive. Sem `interactive` (salvamento automático), não tenta
 * renovar o login — o navegador bloquearia o popup fora de um clique.
 */
function flushSave(interactive = false) {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (inflight) { saveAgain = true; return inflight; }
    if (!hasUnsaved() || !state.data) return Promise.resolve();
    if (!interactive && !hasValidToken()) { setSync(navigator.onLine ? 'auth' : 'offline'); return Promise.resolve(); }

    const version = changeVersion;
    setSync('saving');
    inflight = saveData(state.fileId, state.data)
        .then(id => {
            state.fileId = id;
            savedVersion = version;
            lastPull = lastPull || Date.now();
            writeCache();
            if (!hasUnsaved()) setSync('saved');
        })
        .catch(err => {
            console.error('Erro ao salvar:', err);
            setSync(!navigator.onLine ? 'offline' : (err?.name === 'AuthError' || err?.status === 401) ? 'auth' : 'error');
        })
        .finally(() => {
            inflight = null;
            if (saveAgain) { saveAgain = false; if (hasUnsaved()) flushSave(); }
        });
    return inflight;
}

function resetSync() {
    clearTimeout(saveTimer);
    changeVersion = savedVersion = 0;
    saveAgain = false;
    lastPull = 0;
    setSync('saved');
}

/**
 * Sincroniza com o Drive: se há alterações locais, envia; senão, busca a versão
 * do Drive (pode ter sido alterada em outro aparelho). Requer token válido.
 */
function syncWithDrive() {
    if (syncing) return syncing;
    if (!hasValidToken()) {
        setSync(hasUnsaved() ? 'auth' : 'stale');
        return Promise.resolve();
    }
    syncing = (async () => {
        try {
            if (!hasUnsaved()) setSync('saving');
            const fileId = await findDataFile();
            if (hasUnsaved()) {
                state.fileId = fileId; // se o arquivo sumiu (apagado em outro aparelho), cria um novo
                await flushSave();
                return;
            }
            const remote = fileId ? await readData(fileId) : null;
            if (hasUnsaved()) { await flushSave(); return; } // usuário alterou algo durante o download
            state.fileId = fileId;
            lastPull = Date.now();
            if (remote) {
                const incoming = normalizeData(remote);
                if (JSON.stringify(incoming) !== JSON.stringify(state.data)) {
                    state.data = incoming;
                    rerenderAfterSync();
                }
            } else if (fileId === null && state.data) {
                // nada no Drive ainda: envia a cópia local
                changeVersion++;
                await flushSave();
                return;
            }
            writeCache();
            setSync('saved');
            if (!getAccountHint()) getUserEmail().then(setAccountHint).catch(() => {});
            updatePlan();
        } catch (e) {
            console.error('Erro ao sincronizar:', e);
            const authErr = e?.name === 'AuthError' || e?.status === 401;
            if (authErr) invalidateToken();
            setSync(!navigator.onLine ? 'offline' : authErr ? (hasUnsaved() ? 'auth' : 'stale') : 'error');
        } finally {
            syncing = null;
        }
    })();
    return syncing;
}

/** Renova o token (precisa ser chamado dentro de um toque) e sincroniza. */
function syncNow() {
    if (!isAuthReady()) { toast('Sem conexão com o Google no momento.', { type: 'error' }); return; }
    const renew = hasValidToken() ? Promise.resolve() : getToken(); // abre o popup ainda dentro do toque
    renew.then(() => syncWithDrive()).catch(e => {
        console.error(e);
        if (e?.type !== 'popup_closed') toast('Não foi possível conectar ao Google. Tente novamente.', { type: 'error' });
        setSync(hasUnsaved() ? 'auth' : 'stale');
    });
}

function rerenderAfterSync() {
    renderPlatformInputs();
    const active = document.querySelector('.screen.active')?.id;
    if (GESTAO_SCREENS.includes(active)) gestao.render(active);
    else if (active === 'dashboard-screen') renderDashboard();
    else if (active === 'reports-screen') renderReports();
    else if (active === 'goals-screen') renderGoals();
    else if (active === 'profile-screen') renderProfile();
    else if (active === 'setup-screen' && L.isConfigured(settings())) showScreen('dashboard-screen');
}

// ═══════════════════════ Navegação ═══════════════════════
function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id));
    const isMain = MAIN_SCREENS.includes(id);
    const isGestao = GESTAO_SCREENS.includes(id);
    $('bottom-nav').hidden = !isMain || isGestao;
    $('gestao-nav').hidden = !isGestao;
    $('fin-fab').hidden = !isGestao;
    $('appbar').hidden = !(isMain || id === 'setup-screen');
    document.body.classList.toggle('has-nav', isMain);
    document.body.classList.toggle('mode-gestao', isGestao);
    $('brand-name').textContent = isGestao ? 'Gestão' : 'Na Pista';
    $('brand-sub').hidden = !isGestao;
    // o botão de troca aparece nas telas principais (não no cadastro inicial)
    const sw = $('btn-switch-mode');
    sw.hidden = !isMain;
    $('mode-switch-label').textContent = isGestao ? 'Na Pista' : 'Gestão';
    sw.setAttribute('aria-label', isGestao ? 'Voltar para o Na Pista' : 'Abrir a Gestão na Pista');
    if (isMain) setLastMode(isGestao ? 'gestao' : 'napista');
    document.querySelectorAll('.nav-item').forEach(b => {
        const active = b.dataset.target === id;
        b.classList.toggle('active', active);
        if (active) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    window.scrollTo({ top: 0 });

    if (id === 'dashboard-screen') renderDashboard();
    if (id === 'reports-screen') renderReports();
    if (id === 'goals-screen') renderGoals();
    if (id === 'profile-screen') renderProfile();
    if (isGestao) gestao.render(id);
    renderAds();
}

// ── Na Pista ⇄ Gestão na Pista ──
function getLastMode() {
    try { return localStorage.getItem(MODE_KEY) === 'gestao' ? 'gestao' : 'napista'; } catch { return 'napista'; }
}

function setLastMode(mode) {
    try { localStorage.setItem(MODE_KEY, mode); } catch { /* ignora */ }
}

/** Abre a Gestão na Pista (no primeiro acesso, pergunta líquido ou bruto). */
function openGestao() {
    if (!P.can.finance()) {
        openPlans('completo', 'A Gestão na Pista (contas, cartões, despesas e receitas) faz parte do plano Completo.');
        return false;
    }
    gestao.resetMonth();
    showScreen('fin-home-screen');
    if (gestao.needsOnboarding()) gestao.openOnboarding();
    return true;
}

function switchMode() {
    const active = document.querySelector('.screen.active')?.id;
    if (GESTAO_SCREENS.includes(active)) showScreen('dashboard-screen');
    else openGestao();
}

/** Abre um dia no Na Pista (usado pelos lançamentos que vêm dos apps). */
function openNaPistaDay(key) {
    state.scope = 'day';
    state.anchor = state.dayAnchor = L.parseDateKey(key);
    showScreen('dashboard-screen');
}

function showLoading(message = 'Carregando…') {
    $('loading-message').textContent = message;
    $('loading-spinner').hidden = false;
    $('btn-retry').hidden = true;
    showScreen('loading-screen');
}

function showLoadError(message, retry) {
    $('loading-message').textContent = message;
    $('loading-spinner').hidden = true;
    const btn = $('btn-retry');
    btn.hidden = false;
    btn.onclick = retry;
    showScreen('loading-screen');
}

// ═══════════════════════ Inicialização / login ═══════════════════════
async function boot() {
    const cache = readCache();
    if (cache) {
        // Abre na hora com os dados do aparelho; o login do Google carrega em segundo plano.
        openWithData(cache.data, cache.fileId, !!cache.dirty);
        initAuth()
            .then(ok => { if (ok) syncWithDrive(); else setSync(hasUnsaved() ? 'auth' : 'stale'); })
            .catch(e => { console.error(e); setSync(navigator.onLine ? (hasUnsaved() ? 'auth' : 'stale') : 'offline'); });
        return;
    }

    showLoading();
    try {
        const hasSession = await initAuth();
        if (hasSession) await loadUserData();
        else showScreen('login-screen');
    } catch (e) {
        console.error(e);
        showLoadError('Não foi possível carregar o login do Google. Verifique sua conexão ou desative bloqueadores de anúncio.', () => location.reload());
    }
}

function openWithData(data, fileId, dirty = false) {
    resetSync();
    state.data = normalizeData(data);
    state.fileId = fileId ?? null;
    state.anchor = state.dayAnchor = todayDate();
    state.scope = 'day';
    if (dirty) changeVersion = 1;
    writeCache();
    renderPlatformInputs();
    if (!L.isConfigured(state.data.settings)) openSetup();
    else if (getLastMode() !== 'gestao' || !openGestao()) showScreen('dashboard-screen');
    renderPlanUI();
}

async function handleLogin() {
    const btn = $('btn-login');
    btn.disabled = true;
    try {
        await login(); // abre o popup de forma síncrona dentro do clique
        await loadUserData();
    } catch (e) {
        console.error(e);
        if (e?.type !== 'popup_closed') toast('Não foi possível entrar. Tente novamente.', { type: 'error' });
    } finally {
        btn.disabled = false;
    }
}

async function loadUserData() {
    showLoading('Carregando seus dados…');
    try {
        const fileId = await findDataFile();
        const data = fileId ? await readData(fileId) : null;
        openWithData(data, fileId);
        lastPull = Date.now();
        getUserEmail().then(setAccountHint).catch(() => {});
        updatePlan();
    } catch (e) {
        console.error(e);
        if (e?.name === 'AuthError' || e?.status === 401 || e?.status === 403) {
            invalidateToken();
            showScreen('login-screen');
            toast('Não foi possível acessar sua conta. Entre novamente.');
        } else {
            showLoadError('Não foi possível acessar seu Google Drive. Verifique a conexão.', loadUserData);
        }
    }
}

// ═══════════════════════ Configuração (metas) ═══════════════════════
function openSetup() {
    const s = settings();
    const configured = L.isConfigured(s);
    $('setup-title').textContent = configured ? 'Editar metas' : 'Primeiros passos';
    $('btn-finish-setup').textContent = configured ? 'Salvar alterações' : 'Salvar e começar';
    $('btn-cancel-setup').hidden = !configured;

    state.setupWeekdays = L.defaultWorkWeekdays(s);
    renderWeekdayChips('setup-weekdays', state.setupWeekdays);
    $('setup-meta').value = moneyInput(L.num(s.metaLiquidaMensal));
    $('setup-pagamento-km').value = moneyInput(L.num(s.mediaPagamentoKm));
    $('setup-consumo').value = decimalInput(L.num(s.mediaConsumoL));
    $('setup-preco-comb').value = moneyInput(L.num(s.mediaPrecoCombustivel));

    state.setupPlatforms = [...s.plataformas];
    state.setupOptions = [...new Set([...PRESET_PLATFORMS, ...s.plataformas])];
    renderSetupPlatforms();
    updateSetupPreview();
    showScreen('setup-screen');
}

function readSetupForm() {
    return {
        diasSemana: [...state.setupWeekdays].sort((a, b) => a - b),
        diasTrabalhoMes: Math.round(state.setupWeekdays.length * L.WEEKS_PER_MONTH),
        metaLiquidaMensal: parseDecimal($('setup-meta').value),
        mediaPagamentoKm: parseDecimal($('setup-pagamento-km').value),
        mediaConsumoL: parseDecimal($('setup-consumo').value),
        mediaPrecoCombustivel: parseDecimal($('setup-preco-comb').value)
    };
}

function updateSetupPreview() {
    const f = readSetupForm();
    const el = $('setup-preview');
    if (!f.mediaConsumoL || !f.mediaPrecoCombustivel || !f.mediaPagamentoKm) { el.hidden = true; return; }

    const custoKm = f.mediaPrecoCombustivel / f.mediaConsumoL;
    const lucroKm = f.mediaPagamentoKm - custoKm;
    el.hidden = false;
    el.classList.toggle('warn', lucroKm <= 0);

    if (lucroKm <= 0) {
        el.innerHTML = `<div>O combustível custa <strong>${brl(custoKm)}/km</strong>, mais do que você recebe por km. Assim não há lucro. Revise os valores.</div>`;
        return;
    }

    const rows = [
        ['Custo de combustível por km', brl(custoKm)],
        ['Lucro por km', brl(lucroKm)]
    ];
    if (f.metaLiquidaMensal && f.diasSemana.length) {
        const diasMes = L.workDaysInMonth(f, new Date());
        const metaDia = f.metaLiquidaMensal / diasMes;
        rows.push([`Dias de trabalho em ${MONTHS[new Date().getMonth()].toLowerCase()}`, String(diasMes)]);
        rows.push(['Meta líquida por dia', brl(metaDia)]);
        rows.push(['Rodagem estimada por dia', `${fmt(metaDia / lucroKm, 0)} km`]);
    }
    el.innerHTML = rows.map(([k, v]) => `<div class="preview-row"><span>${k}</span><strong>${v}</strong></div>`).join('');
}

function renderSetupPlatforms() {
    $('setup-platforms').innerHTML = state.setupOptions.map(p => `
        <button type="button" class="chip" data-platform="${esc(p)}" aria-pressed="${state.setupPlatforms.includes(p)}">${esc(p)}</button>
    `).join('');
}

function addCustomPlatform() {
    const input = $('setup-other-app');
    const name = input.value.trim().replace(/\s+/g, ' ');
    if (!name) return;
    const existing = state.setupOptions.find(p => p.toLowerCase() === name.toLowerCase());
    const finalName = existing || name;
    if (!existing) state.setupOptions.push(finalName);
    if (!state.setupPlatforms.includes(finalName)) state.setupPlatforms.push(finalName);
    input.value = '';
    renderSetupPlatforms();
}

function saveSetup(e) {
    e.preventDefault();
    const f = readSetupForm();
    const fail = (msg, id) => { toast(msg, { type: 'error' }); if (id) $(id).focus(); };

    if (!(f.metaLiquidaMensal > 0)) return fail('Informe sua meta líquida mensal.', 'setup-meta');
    if (!f.diasSemana.length) return fail('Escolha os dias da semana em que você trabalha.');
    if (!(f.mediaPagamentoKm > 0)) return fail('Informe a média que você aceita por km.', 'setup-pagamento-km');
    if (!(f.mediaConsumoL > 0)) return fail('Informe o consumo médio do veículo.', 'setup-consumo');
    if (!(f.mediaPrecoCombustivel > 0)) return fail('Informe o preço do litro.', 'setup-preco-comb');
    if (f.mediaPagamentoKm <= f.mediaPrecoCombustivel / f.mediaConsumoL) return fail('O custo do combustível por km está maior que o ganho por km.', 'setup-pagamento-km');
    if (!state.setupPlatforms.length) return fail('Selecione pelo menos um aplicativo.');

    const wasConfigured = L.isConfigured(settings());
    // mantém a ordem das opções exibidas
    const plataformas = state.setupOptions.filter(p => state.setupPlatforms.includes(p));
    // primeiro cadastro (ou depois de apagar os dados): hoje é o "dia 0"
    const dataInicio = wasConfigured ? settings().dataInicio : L.toDateKey(todayDate());
    state.data.settings = { ...settings(), ...f, plataformas, dataInicio };
    renderPlatformInputs();
    markChanged(0);
    toast(wasConfigured ? 'Metas atualizadas.' : 'Tudo pronto! Bom trabalho na pista.');
    showScreen('dashboard-screen');
}

// ═══════════════════════ Início (dashboard) ═══════════════════════
function renderPlatformInputs() {
    $('platform-inputs').innerHTML = settings().plataformas.map(p => `
        <label class="field field-inline">
            <span class="field-label"><span class="plat-dot" style="--c:${platformColor(p)}"></span>${esc(p)}</span>
            <span class="input-wrap"><span class="prefix">R$</span><input type="text" inputmode="numeric" class="money day-input plat-input" data-plat="${esc(p)}" placeholder="0,00" autocomplete="off"></span>
        </label>
    `).join('');
}

const dayKey = () => L.toDateKey(state.anchor);

function renderDashboard() {
    if (!state.data) return;
    const isDay = state.scope === 'day';
    document.querySelectorAll('#scope-seg .seg-btn').forEach(b => {
        const active = b.dataset.scope === state.scope;
        b.classList.toggle('active', active);
        b.setAttribute('aria-selected', active);
    });
    $('day-entry').hidden = !isDay;
    $('btn-add-expense').hidden = !isDay;
    renderDateNav();
    if (isDay) fillDayForm();
    refreshDashboard();
}

function refreshDashboard() {
    const r = L.calculateTargets(state.scope, settings(), state.data.history, state.anchor, new Date());
    renderHero(r);
    renderStats(r.summary);
    renderExpenses(r.summary);
    renderGoalWidget();
}

function renderDateNav() {
    const a = state.anchor;
    const today = todayDate();
    const { start, end } = L.getPeriodRange(state.scope, a);
    const containsToday = today >= start && today <= end;
    let title, sub;

    if (state.scope === 'day') {
        const diff = Math.round((a - today) / 86400000);
        title = diff === 0 ? 'Hoje' : diff === -1 ? 'Ontem' : diff === 1 ? 'Amanhã' : WEEKDAYS[a.getDay()];
        sub = `${diff >= -1 && diff <= 1 ? WEEKDAYS[a.getDay()] + ', ' : ''}${a.getDate()} de ${MONTHS[a.getMonth()].toLowerCase()}${a.getFullYear() !== today.getFullYear() ? ' de ' + a.getFullYear() : ''}`;
    } else if (state.scope === 'week') {
        const weeksDiff = Math.round((start - L.getWeekRange(today).start) / (7 * 86400000));
        title = weeksDiff === 0 ? 'Esta semana' : weeksDiff === -1 ? 'Semana passada' : 'Semana';
        sub = `${shortDate(start)} a ${shortDate(end)}${end.getFullYear() !== today.getFullYear() ? '/' + end.getFullYear() : ''}`;
    } else {
        title = `${MONTHS[a.getMonth()]}${a.getFullYear() !== today.getFullYear() ? ' ' + a.getFullYear() : ''}`;
        sub = containsToday ? 'Este mês' : `${shortDate(start)} a ${shortDate(end)}`;
    }

    $('date-title').textContent = title;
    $('date-sub').textContent = sub;
    $('btn-today').hidden = containsToday;
}

function navigateDate(direction) {
    const a = new Date(state.anchor);
    if (state.scope === 'day') a.setDate(a.getDate() + direction);
    else if (state.scope === 'week') a.setDate(a.getDate() + direction * 7);
    else { a.setDate(1); a.setMonth(a.getMonth() + direction); }
    setAnchor(a);
}

function setAnchor(date) {
    state.anchor = L.startOfDay(date);
    if (state.scope === 'day') state.dayAnchor = new Date(state.anchor);
    renderDashboard();
}

function setScope(scope) {
    if (scope === state.scope) return;
    if (scope === 'day') {
        // Volta ao último dia escolhido se ele estiver no período exibido;
        // senão, hoje (se estiver no período) ou o primeiro dia do período.
        const { start, end } = L.getPeriodRange(state.scope, state.anchor);
        const today = todayDate();
        const inRange = (d) => d >= start && d <= end;
        state.anchor = inRange(state.dayAnchor) ? new Date(state.dayAnchor) : inRange(today) ? today : new Date(start);
        state.dayAnchor = new Date(state.anchor);
    }
    state.scope = scope;
    renderDashboard();
}

function openDatePicker() {
    const picker = $('date-picker');
    picker.value = L.toDateKey(state.anchor);
    try {
        if (typeof picker.showPicker === 'function') picker.showPicker();
        else { picker.focus(); picker.click(); }
    } catch {
        picker.focus();
        picker.click();
    }
}

function fillDayForm() {
    const s = settings();
    const day = findDay(dayKey());
    document.querySelectorAll('.plat-input').forEach(inp => {
        inp.value = moneyInput(L.num(day?.earnings?.[inp.dataset.plat]));
    });
    $('day-km').value = decimalInput(L.num(day?.km));
    $('day-consumo').value = decimalInput(L.num(day?.consumoL));
    $('day-preco').value = moneyInput(L.num(day?.precoL));
    $('day-consumo').placeholder = fmt(L.num(s.mediaConsumoL));
    $('day-preco').placeholder = moneyInput(L.num(s.mediaPrecoCombustivel));
}

function commitDayForm() {
    const key = dayKey();
    let day = findDay(key);
    const earnings = { ...(day?.earnings || {}) }; // preserva apps que não estão mais nas configurações
    document.querySelectorAll('.plat-input').forEach(inp => {
        const v = parseDecimal(inp.value);
        if (v > 0) earnings[inp.dataset.plat] = v;
        else delete earnings[inp.dataset.plat];
    });
    const km = parseDecimal($('day-km').value);
    const consumo = parseDecimal($('day-consumo').value);
    const preco = parseDecimal($('day-preco').value);

    if (!day) {
        if (!Object.keys(earnings).length && !km && !consumo && !preco) return;
        day = getOrCreateDay(key);
    }
    day.earnings = earnings;
    day.km = km;
    if (consumo > 0) day.consumoL = consumo; else delete day.consumoL;
    if (preco > 0) day.precoL = preco; else delete day.precoL;
    pruneDay(day);

    markChanged();
    refreshDashboard();
}

function renderHero(r) {
    const hero = $('hero');
    const word = { day: 'do dia', week: 'da semana', month: 'do mês' }[state.scope];
    const tip = $('hero-tip');
    const fix = $('hero-fix');
    tip.hidden = true;
    fix.hidden = true;

    if (r.error) {
        hero.dataset.state = 'error';
        $('hero-label').textContent = 'Revise suas metas';
        $('hero-value').textContent = 'Sem lucro por km';
        $('hero-sub').textContent = r.error;
        $('hero-badge').textContent = '—';
        $('hero-progress').style.width = '0%';
        $('hero-net').textContent = brl(r.summary.net);
        $('hero-target').textContent = '—';
        fix.hidden = false;
        return;
    }

    const pct = Math.round(r.progress * 100);
    $('hero-badge').textContent = `${pct}%`;
    $('hero-progress').style.width = `${pct}%`;
    $('hero-progressbar').setAttribute('aria-valuenow', pct);
    $('hero-net').textContent = brl(r.summary.net);
    $('hero-target').textContent = brl(r.meta);

    if (r.antesDoInicio) {
        hero.dataset.state = 'done';
        $('hero-label').textContent = 'Antes do seu início no app';
        $('hero-value').textContent = 'Meta considerada batida';
        $('hero-sub').textContent = `você começou em ${fullDate(settings().dataInicio)}`;
        $('hero-target').textContent = '—';
        return;
    }

    if (r.metaAlcancada) {
        hero.dataset.state = 'done';
        $('hero-label').textContent = `Meta ${word} batida`;
        if (r.metaBruta != null) {
            $('hero-value').textContent = `+ ${brl(r.excedenteBruto)}`;
            $('hero-sub').textContent = `bruto acima da meta · + ${brl(r.excedente)} líquido`;
            $('hero-target').textContent = `${brl(r.metaBruta)} bruto`;
        } else {
            $('hero-value').textContent = `+ ${brl(r.excedente)}`;
            $('hero-sub').textContent = 'acima da meta líquida';
        }
        if (r.status === 'current') {
            tip.hidden = false;
            tip.textContent = 'Tudo o que entrar agora é lucro extra. Uma folga também vale.';
        }
    } else if (r.status === 'past') {
        hero.dataset.state = 'missed';
        $('hero-label').textContent = `Faltou para a meta ${word}`;
        $('hero-value').textContent = brl(r.faltaLiquido);
        $('hero-sub').textContent = 'de lucro líquido';
    } else {
        hero.dataset.state = 'progress';
        const label = { day: 'Falta faturar no dia', week: 'Falta faturar na semana', month: 'Falta faturar no mês' }[state.scope];
        $('hero-label').textContent = label;
        $('hero-value').textContent = brl(r.brutoFaltante);
        $('hero-sub').textContent = `bruto · cerca de ${fmt(r.kmFaltante, 0)} km a mais · ${brl(r.faltaLiquido)} líquido`;
        if (state.scope !== 'day' && r.diasRestantes > 0) {
            tip.hidden = false;
            tip.textContent = r.diasRestantes === 1
                ? `Último dia de trabalho do período: ${brl(r.brutoFaltante)} brutos.`
                : `Sugestão: ${brl(r.brutoPorDia)} por dia (≈ ${fmt(r.kmPorDia, 0)} km) nos próximos ${r.diasRestantes} dias de trabalho.`;
        }
    }

    if (r.inicioParcial) {
        const note = `Meta proporcional: os dias antes de ${shortDate(L.parseDateKey(r.inicioParcial))} (seu início) sem lançamentos contam como batidos.`;
        tip.textContent = tip.hidden ? note : `${tip.textContent} ${note}`;
        tip.hidden = false;
    }
}

function renderStats(sum) {
    $('stat-gross').textContent = brl(sum.gross);
    $('stat-fuel').textContent = brl(sum.fuel);
    $('stat-fuel-sub').textContent = sum.km > 0 ? `${fmt(sum.liters, 1)} L estimados` : 'estimado';
    $('stat-exp').textContent = brl(sum.expenses);
    $('stat-km').textContent = `${fmt(sum.km, sum.km % 1 ? 1 : 0)} km`;
    $('stat-km-sub').textContent = sum.km > 0 && sum.gross > 0 ? `${brl(sum.grossPerKm)}/km` : '';
    $('day-gross-total').textContent = brl(sum.gross);
    renderFinanceDayHint();
}

function renderFinanceDayHint() {
    const el = $('fin-day-hint');
    const text = state.scope === 'day' && P.can.finance() ? gestao.dayHint(dayKey()) : '';
    el.hidden = !text;
    el.textContent = text;
    $('fin-exp-hint').hidden = !(P.can.finance() && state.data.finance?.setupDone);
}

function renderExpenses(sum) {
    const list = $('expense-list');
    const isDay = state.scope === 'day';
    $('expense-total').textContent = sum.expenses > 0 ? brl(sum.expenses) : '';

    if (isDay) {
        const items = findDay(dayKey())?.detailedExpenses || [];
        list.innerHTML = items.length
            ? items.map((e, i) => `
                <li class="list-item">
                    <button type="button" class="item-main" data-edit="${i}">
                        <span class="item-title">${esc(e.desc)}</span>
                        <span class="item-sub">Toque para editar</span>
                    </button>
                    <span class="item-value neg">${brl(L.num(e.val))}</span>
                    <button type="button" class="icon-btn" data-del="${i}" aria-label="Remover ${esc(e.desc)}">${ICON_TRASH}</button>
                </li>`).join('')
            : '<li class="empty">Nenhum gasto neste dia.</li>';
    } else {
        list.innerHTML = sum.expenseItems.length
            ? sum.expenseItems.map(e => {
                const d = L.parseDateKey(e.date);
                return `
                <li class="list-item">
                    <div class="item-main">
                        <span class="item-title">${esc(e.desc)}</span>
                        <span class="item-sub">${WEEKDAYS_SHORT[d.getDay()]}, ${shortDate(d)}</span>
                    </div>
                    <span class="item-value neg">${brl(e.val)}</span>
                </li>`;
            }).join('')
            : `<li class="empty">Nenhum gasto ${state.scope === 'week' ? 'nesta semana' : 'neste mês'}.</li>`;
    }
}

// ── Gastos ──
function openExpenseDialog(index = null) {
    const day = findDay(dayKey());
    const item = index !== null ? day?.detailedExpenses?.[index] : null;
    state.editingExpense = item ? index : null;
    $('expense-dialog-title').textContent = item ? 'Editar gasto' : 'Novo gasto';
    $('expense-desc').value = item?.desc || '';
    $('expense-val').value = item ? moneyInput(L.num(item.val)) : '';
    $('expense-suggestions').innerHTML = EXPENSE_SUGGESTIONS.map(s => `<button type="button" class="chip" data-suggest="${esc(s)}">${esc(s)}</button>`).join('');
    $('expense-dialog').showModal();
    if (!item) setTimeout(() => $('expense-desc').focus(), 50);
}

function saveExpense(e) {
    e.preventDefault();
    const desc = $('expense-desc').value.trim();
    const val = parseDecimal($('expense-val').value);
    if (!desc) { toast('Informe a descrição do gasto.', { type: 'error' }); $('expense-desc').focus(); return; }
    if (!(val > 0)) { toast('Informe um valor maior que zero.', { type: 'error' }); $('expense-val').focus(); return; }

    const day = getOrCreateDay(dayKey());
    if (state.editingExpense !== null && day.detailedExpenses[state.editingExpense]) {
        day.detailedExpenses[state.editingExpense] = { desc, val };
    } else {
        day.detailedExpenses.push({ desc, val });
    }
    day.expenses = L.dayExpenses(day);
    $('expense-dialog').close();
    markChanged(600);
    refreshDashboard();
}

function removeExpense(index) {
    const key = dayKey();
    const day = findDay(key);
    if (!day?.detailedExpenses?.[index]) return;
    const [removed] = day.detailedExpenses.splice(index, 1);
    day.expenses = L.dayExpenses(day);
    pruneDay(day);
    markChanged();
    refreshDashboard();

    toast(`"${removed.desc}" removido.`, {
        action: 'Desfazer',
        onAction: () => {
            const d = getOrCreateDay(key);
            d.detailedExpenses.splice(Math.min(index, d.detailedExpenses.length), 0, removed);
            d.expenses = L.dayExpenses(d);
            markChanged();
            refreshDashboard();
        }
    });
}

// ═══════════════════════ Relatórios ═══════════════════════
function buildReportGroups(tab) {
    const history = state.data.history;
    const groups = new Map();
    const add = (key, make, day) => {
        if (!groups.has(key)) groups.set(key, { key, ...make(), days: [] });
        groups.get(key).days.push(day);
    };

    if (tab === 'range') {
        if (!state.range) return [];
        const days = L.filterRange(history, state.range.start, state.range.end);
        const s = L.parseDateKey(state.range.start), e = L.parseDateKey(state.range.end);
        return days.length ? [{ key: 'range', label: `${shortDate(s)}/${s.getFullYear()} a ${shortDate(e)}/${e.getFullYear()}`, days }] : [];
    }

    history.forEach(day => {
        const d = L.parseDateKey(day.date);
        if (tab === 'days') {
            add(day.date, () => ({ label: `${WEEKDAYS_SHORT[d.getDay()]}, ${shortDate(d)}`, sub: String(d.getFullYear()) }), day);
        } else if (tab === 'weeks') {
            const { start, end } = L.getWeekRange(d);
            add(L.toDateKey(start), () => ({ label: `${shortDate(start)} a ${shortDate(end)}`, sub: String(end.getFullYear()) }), day);
        } else {
            const key = day.date.slice(0, 7);
            add(key, () => ({ label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}` }), day);
        }
    });

    return [...groups.values()].sort((a, b) => b.key.localeCompare(a.key));
}

function renderReports() {
    if (!state.data) return;
    const tab = state.reportTab;
    document.querySelectorAll('#report-seg .seg-btn').forEach(b => {
        const active = b.dataset.tab === tab;
        b.classList.toggle('active', active);
        b.setAttribute('aria-selected', active);
    });
    $('range-form').hidden = tab !== 'range';

    if (tab === 'range' && !state.range) {
        const today = todayDate();
        state.range = { start: L.toDateKey(new Date(today.getFullYear(), today.getMonth(), 1)), end: L.toDateKey(today) };
    }
    if (tab === 'range') {
        $('range-start').value = state.range.start;
        $('range-end').value = state.range.end;
    }

    const groups = buildReportGroups(tab);
    const hasData = groups.length > 0;
    $('report-empty').hidden = hasData;
    $('report-body').hidden = !hasData;
    if (!hasData) {
        $('report-empty').querySelector('p').textContent = tab === 'range' ? 'Nenhum lançamento nesse período.' : 'Nenhum lançamento por aqui ainda.';
        return;
    }

    const s = settings();
    let selected = groups.find(g => g.key === state.reportKey) || groups[0];
    state.reportKey = selected.key;

    // Mostra só os mais recentes; "Mostrar mais" libera de 5 em 5
    const limit = state.reportLimit;
    let total;
    if (tab === 'range') {
        // Na aba período, a lista mostra os dias do intervalo filtrado
        const days = [...selected.days].sort((a, b) => b.date.localeCompare(a.date));
        total = days.length;
        $('report-list-title').textContent = `Dias no período (${total})`;
        $('report-list').innerHTML = days.slice(0, limit).map(day => {
            const d = L.parseDateKey(day.date);
            return reportRow({ label: `${WEEKDAYS_SHORT[d.getDay()]}, ${shortDate(d)}`, sub: String(d.getFullYear()) }, L.summarize([day], s), false);
        }).join('');
    } else {
        total = groups.length;
        $('report-list-title').textContent = { days: 'Dias', weeks: 'Semanas', months: 'Meses' }[tab];
        // o item selecionado continua visível mesmo se estiver além do limite
        const visible = groups.filter((g, i) => i < limit || g.key === selected.key);
        $('report-list').innerHTML = visible.map(g => reportRow(g, L.summarize(g.days, s), true, g.key === selected.key)).join('');
    }
    const hiddenCount = total - Math.min(total, limit);
    $('report-more').hidden = hiddenCount <= 0;
    $('btn-report-more').textContent = `Mostrar mais (${hiddenCount} ${hiddenCount === 1 ? 'restante' : 'restantes'})`;

    renderReportSummary(selected);
}

function reportRow(g, sum, selectable, isSelected = false) {
    const tag = selectable ? 'button' : 'div';
    return `
        <li>
            <${tag} ${selectable ? `type="button" data-group="${esc(g.key)}" aria-pressed="${isSelected}"` : ''} class="list-item ${isSelected ? 'selected' : ''}">
                <span class="item-main">
                    <span class="item-title">${esc(g.label)}</span>
                    <span class="item-sub">${g.sub ? esc(g.sub) + ' · ' : ''}${sum.days > 1 ? `${sum.workedDays} ${sum.workedDays === 1 ? 'dia' : 'dias'} · ` : ''}${fmt(sum.km, 0)} km</span>
                </span>
                <span class="item-value ${sum.net < 0 ? 'neg' : 'pos'}">${brl(sum.net)}<small>bruto ${brl(sum.gross)}</small></span>
            </${tag}>
        </li>`;
}

function renderReportSummary(group) {
    const s = settings();
    const sum = L.summarize(group.days, s);
    state.reportExpenses = sum.expenseItems;

    const kind = { days: '', weeks: 'Semana · ', months: '', range: 'Período · ' }[state.reportTab];
    $('rep-period').textContent = `${kind}${group.label}`;
    $('rep-net').textContent = brl(sum.net);
    $('rep-net').className = `hero-value ${sum.net < 0 ? 'neg' : ''}`;
    $('rep-net-sub').textContent = `lucro líquido · ${sum.workedDays} ${sum.workedDays === 1 ? 'dia trabalhado' : 'dias trabalhados'}`;
    $('rep-gross').textContent = brl(sum.gross);
    $('rep-fuel').textContent = brl(sum.fuel);
    $('rep-exp').textContent = brl(sum.expenses);
    $('rep-km').textContent = `${fmt(sum.km, 0)} km`;
    $('rep-gpk').textContent = sum.km > 0 ? brl(sum.grossPerKm) : '—';
    $('rep-cpk').textContent = brl(sum.costPerKm);
    $('rep-consumo').textContent = `${fmt(sum.avgConsumo)} km/L`;
    $('rep-preco').textContent = brl(sum.avgPreco);

    // Gráfico por aplicativo (inclui apps antigos que existam no histórico)
    const names = [...new Set([...s.plataformas, ...Object.keys(sum.byPlatform)])];
    const rows = names.map(p => ({ p, v: sum.byPlatform[p] || 0 })).sort((a, b) => b.v - a.v);
    const max = Math.max(...rows.map(r => r.v), 0);
    $('report-chart').innerHTML = max === 0
        ? '<p class="muted small">Sem ganhos registrados neste período.</p>'
        : rows.map(({ p, v }) => `
            <div class="hbar">
                <div class="hbar-head"><span>${esc(p)}</span><span>${brl(v)}<small>${sum.gross > 0 ? Math.round(v / sum.gross * 100) : 0}%</small></span></div>
                <div class="hbar-track"><div class="hbar-fill" style="width:${(v / max * 100).toFixed(1)}%; --c:${platformColor(p)}"></div></div>
            </div>`).join('');
}

function openReportExpenses() {
    const items = state.reportExpenses || [];
    $('report-expenses-list').innerHTML = items.length
        ? items.map(e => {
            const d = L.parseDateKey(e.date);
            return `<li class="list-item"><div class="item-main"><span class="item-title">${esc(e.desc)}</span><span class="item-sub">${WEEKDAYS_SHORT[d.getDay()]}, ${shortDate(d)}</span></div><span class="item-value neg">${brl(e.val)}</span></li>`;
        }).join('')
        : '<li class="empty">Nenhum gasto extra neste período.</li>';
    $('report-expenses-dialog').showModal();
}

// ═══════════════════════ Metas com prazo ═══════════════════════
const goals = () => state.data.goals;
const goalTitle = (g) => g.name?.trim() || `Meta de ${brl(L.num(g.amount))}`;
const fullDate = (key) => { const d = L.parseDateKey(key); return `${shortDate(d)}/${d.getFullYear()}`; };
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const isOpenGoal = (r) => r.status === 'active' || r.status === 'scheduled';
const ICON_UP = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg>';
const ICON_DOWN = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';

const weekdaysLabel = (days) => (days.length === 7 ? 'todos os dias'
    : days.slice().sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map(d => WEEKDAYS_SHORT[d]).join(', '));

/** Metas avaliadas juntas (cascata por prioridade) + plano combinado. */
function goalEval() {
    return L.evaluateGoals(goals(), settings(), state.data.history, new Date());
}

/** Faturamento bruto estimado para sobrar `net` de líquido (média de R$/km menos o combustível). */
function toGross(net) {
    const s = settings();
    const custoKm = L.num(s.mediaConsumoL) > 0 ? L.num(s.mediaPrecoCombustivel) / L.num(s.mediaConsumoL) : 0;
    const lucroKm = L.num(s.mediaPagamentoKm) - custoKm;
    return lucroKm > 0 ? net / lucroKm * L.num(s.mediaPagamentoKm) : null;
}

/** "R$ X brutos (R$ Y líquidos)"; sem lucro por km, mostra só o líquido. */
function grossText(net) {
    const g = toGross(net);
    return g == null ? `<strong>${brl(net)}</strong> líquidos` : `<strong>${brl(g)}</strong> brutos (${brl(net)} líquidos)`;
}

function goalTodayLine(r) {
    if (r.status !== 'active') return '';
    if (!r.todayIsWork) return `<p class="goal-today">Hoje não é dia de trabalho nesta meta. Próximos dias: faturar ${grossText(r.porDia)} por dia.</p>`;
    if (r.hojeFalta <= 0) return '<p class="goal-today ok">Ritmo de hoje cumprido para esta meta.</p>';
    return `<p class="goal-today">Hoje faltam ${grossText(r.hojeFalta)} para ficar no ritmo.</p>`;
}

/** Card "para bater todas as metas". `compact` = versão da tela Início. */
function combinedCard(c, open, compact = false) {
    const falta = open.reduce((a, r) => a + r.falta, 0);
    const today = !c.todayIsWork
        ? '<p class="goal-today">Hoje não é dia de trabalho em nenhuma meta em andamento.</p>'
        : c.hojeFalta <= 0
            ? '<p class="goal-today ok">Ritmo de hoje cumprido para todas as metas.</p>'
            : `<p class="goal-today">Hoje faltam ${grossText(c.hojeFalta)} para ficar no ritmo de todas.</p>`;
    const gross = c.kmPorDia > 0;
    const extra = gross ? `<span>${brl(c.porDia)} líquidos · ≈ ${fmt(c.kmPorDia, 0)} km por dia</span>` : '';
    return `
    <div class="goal-total${compact ? ' compact' : ''}">
        <span class="goal-total-label">Para bater ${open.length === 1 ? 'a meta' : `as ${open.length} metas`}</span>
        <span class="goal-total-value">${gross ? `${brl(c.brutoPorDia)}<small>/dia de faturamento</small>` : `${brl(c.porDia)}<small>/dia líquido</small>`}</span>
        <div class="goal-mini-line"><span>Falta <strong>${brl(falta)}</strong> no total</span><span>${plural(c.diasTrabalho, 'dia de trabalho', 'dias de trabalho')} até ${fullDate(c.lastDeadline)}</span></div>
        ${extra ? `<div class="goal-mini-line">${extra}</div>` : ''}
        ${today}
    </div>`;
}

/** Linha enxuta da tela Início: barra, bruto já feito e quanto falta (bruto estimado). */
function homeGoalRow({ title, progress, gross, falta }) {
    const pct = Math.round(progress * 100);
    const faltaGross = toGross(falta);
    const faltaText = faltaGross == null ? `faltam ${brl(falta)} líquidos` : `faltam ≈ ${brl(faltaGross)}`;
    return `
    <div class="goal-mini">
        <div class="goal-mini-head"><span class="goal-mini-name">${esc(title)}</span><span class="goal-mini-pct">${pct}%</span></div>
        <div class="progress"><div class="progress-fill" style="width:${pct}%"></div></div>
        <div class="goal-mini-line"><span><strong>${brl(gross)}</strong> faturados</span><span>${faltaText}</span></div>
    </div>`;
}

const goalMini = (r) => homeGoalRow({ title: goalTitle(r.goal), progress: r.progress, gross: r.gross, falta: r.falta });

function renderGoalWidget() {
    const body = $('goal-widget-body');
    if (!body || !state.data) return;
    const { results } = goalEval();
    const list = results.filter(isOpenGoal);

    if (!list.length) {
        const finished = goals().length;
        body.innerHTML = `<p class="goal-empty-text">${finished
            ? 'Nenhuma meta em andamento. Crie uma nova e veja quanto precisa fazer por dia.'
            : 'Tem um objetivo? Diga quanto quer fazer de lucro líquido e até quando: calculamos quanto você precisa fazer por dia.'}</p>
            ${finished ? '<div class="goal-more"><button type="button" class="link-btn" data-goto-goals>Ver metas</button></div>' : ''}`;
        return;
    }

    let html;
    if (list.length === 1) {
        html = goalMini(list[0]);
    } else {
        // várias metas: só o agregado, o total para bater todas
        const meta = list.reduce((a, r) => a + r.meta, 0);
        const net = list.reduce((a, r) => a + Math.max(0, r.net), 0);
        html = homeGoalRow({
            title: `Todas as metas (${list.length})`,
            progress: meta > 0 ? Math.min(1, net / meta) : 0,
            gross: list.reduce((a, r) => a + r.gross, 0),
            falta: list.reduce((a, r) => a + r.falta, 0)
        });
    }
    body.innerHTML = html + '<div class="goal-more"><button type="button" class="link-btn" data-goto-goals>Ver metas</button></div>';
}

function renderGoals() {
    if (!state.data) return;
    const { results, combined } = goalEval();
    $('goals-empty').hidden = results.length > 0;

    const open = results.filter(isOpenGoal);
    const closed = results.filter(r => !isOpenGoal(r))
        .sort((a, b) => b.goal.deadline.localeCompare(a.goal.deadline));

    let html = '';
    if (open.length > 1 && combined) {
        html += `<section class="card goal-total-card">${combinedCard(combined, open)}</section>`;
    }
    if (open.length > 1) {
        const manual = L.isManualOrder(goals());
        html += `
        <div class="goal-order-note">
            <span>${manual ? 'Prioridade escolhida por você.' : 'Prioridade automática: prazo mais próximo primeiro; prazo igual, menor valor primeiro.'} O lucro completa a 1ª meta antes de ir para a próxima.</span>
            ${manual ? '<button type="button" class="link-btn" data-goal-auto>Voltar à automática</button>' : ''}
        </div>`;
    }
    const ctx = { openCount: open.length };
    html += open.map((r, i) => goalCard(r, { ...ctx, pos: i })).join('');
    if (closed.length) {
        html += `<h2 class="subhead goals-section-title">Encerradas e concluídas</h2>` + closed.map(r => goalCard(r, ctx)).join('');
    }
    $('goals-list').innerHTML = html;
}

function goalCard(r, ctx) {
    const g = r.goal;
    const pct = Math.round(r.progress * 100);
    const s = settings();
    const open = isOpenGoal(r);

    let details = '';
    if (open) {
        const lucroOk = r.kmPorDia > 0;
        details = `
            <div class="stat-grid">
                ${lucroOk
                    ? `<div class="stat"><span class="stat-label">Faturar por dia</span><span class="stat-value big">${brl(r.brutoPorDia)}</span><span class="stat-sub">bruto · ${plural(r.diasRestantes, 'dia de trabalho', 'dias de trabalho')}</span></div>`
                    : `<div class="stat"><span class="stat-label">Líquido por dia</span><span class="stat-value big">${brl(r.porDia)}</span><span class="stat-sub">${plural(r.diasRestantes, 'dia de trabalho', 'dias de trabalho')}</span></div>`}
                <div class="stat"><span class="stat-label">Falta</span><span class="stat-value">${brl(r.falta)}</span><span class="stat-sub">${plural(r.calendarDaysLeft, 'dia', 'dias')} no calendário</span></div>
                ${lucroOk ? `
                <div class="stat"><span class="stat-label">Líquido por dia</span><span class="stat-value">${brl(r.porDia)}</span><span class="stat-sub">o que sobra no bolso</span></div>
                <div class="stat"><span class="stat-label">Rodar por dia</span><span class="stat-value">≈ ${fmt(r.kmPorDia, 0)} km</span><span class="stat-sub">a ${brl(L.num(s.mediaPagamentoKm))}/km</span></div>` : ''}
            </div>
            ${r.status === 'scheduled' ? `<p class="goal-status">Começa a contar em ${fullDate(g.startDate)}.</p>` : goalTodayLine(r)}`;
    } else if (r.status === 'done') {
        details = '<p class="goal-status">Meta batida!</p>';
    } else {
        details = `<p class="goal-status">Prazo encerrado. Faltaram ${brl(r.falta)} (${pct}% concluído).</p>`;
    }

    // prioridade (setas) e "mostrar no início" só fazem sentido com várias metas em aberto
    const order = open && ctx.openCount > 1 ? `
        <div class="goal-order" role="group" aria-label="Prioridade">
            <button type="button" class="icon-btn" data-goal-move="${esc(g.id)}" data-dir="-1" aria-label="Aumentar prioridade" ${ctx.pos === 0 ? 'disabled' : ''}>${ICON_UP}</button>
            <span class="goal-rank">${ctx.pos + 1}ª</span>
            <button type="button" class="icon-btn" data-goal-move="${esc(g.id)}" data-dir="1" aria-label="Diminuir prioridade" ${ctx.pos === ctx.openCount - 1 ? 'disabled' : ''}>${ICON_DOWN}</button>
        </div>` : '';

    return `
    <article class="card goal-card" data-status="${r.status}">
        <div class="goal-head">
            ${order}
            <div class="goal-head-main">
                <h2 class="goal-name">${esc(goalTitle(g))}</h2>
                <p class="goal-dates">${fullDate(g.startDate)} até ${fullDate(g.deadline)} · ${esc(weekdaysLabel(g.weekdays))}</p>
            </div>
            <span class="badge">${pct}%</span>
        </div>
        <p class="goal-amounts"><strong>${brl(r.net)}</strong> de ${brl(r.meta)} líquidos</p>
        <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><div class="progress-fill" style="width:${pct}%"></div></div>
        ${details}
        <div class="goal-actions">
            <button type="button" class="btn btn-ghost btn-sm" data-goal-edit="${esc(g.id)}">Editar</button>
            <button type="button" class="btn btn-danger-ghost btn-sm" data-goal-del="${esc(g.id)}">Excluir</button>
        </div>
    </article>`;
}

/** Metas ainda no prazo, na ordem de prioridade atual. */
const openGoalOrder = () => {
    const key = L.toDateKey(todayDate());
    return L.orderGoals(goals()).filter(g => g.deadline >= key);
};
const savePriorities = (list) => list.forEach((g, i) => { g.priority = i; });

function moveGoal(id, dir) {
    const { results } = goalEval();
    const shown = results.filter(isOpenGoal).map(r => r.goal);
    const i = shown.findIndex(g => g.id === id);
    const j = i + dir;
    if (i === -1 || j < 0 || j >= shown.length) return;
    const list = openGoalOrder();
    const a = list.indexOf(shown[i]);
    const b = list.indexOf(shown[j]);
    [list[a], list[b]] = [list[b], list[a]];
    savePriorities(list);
    markChanged();
    renderGoals();
}

function resetGoalOrder() {
    goals().forEach(g => { delete g.priority; });
    markChanged();
    renderGoals();
    toast('Prioridade automática restaurada.');
}

/** Prioridade que uma nova meta receberia com a ordem manual (meio-termo entre vizinhas). */
function insertionPriority(others, draft) {
    const key = L.toDateKey(todayDate());
    const list = L.orderGoals(others).filter(g => g.deadline >= key);
    const at = list.findIndex(x => L.goalAutoCompare(draft, x) < 0);
    if (at === -1) return list.length ? (list[list.length - 1].priority ?? list.length) + 1 : 0;
    const next = list[at].priority ?? at;
    const prev = at > 0 ? (list[at - 1].priority ?? at - 1) : next - 1;
    return (prev + next) / 2;
}

function renderWeekdayChips(containerId, selected) {
    // Exibe de segunda a domingo
    $(containerId).innerHTML = [1, 2, 3, 4, 5, 6, 0].map(d => `
        <button type="button" class="chip" data-weekday="${d}" aria-pressed="${selected.includes(d)}" aria-label="${WEEKDAYS[d]}">${WEEKDAYS_SHORT[d]}</button>
    `).join('');
}

/** Liga/desliga o dia clicado na lista `list`. Retorna true se algo mudou. */
function toggleWeekday(e, list) {
    const chip = e.target.closest('[data-weekday]');
    if (!chip) return false;
    const d = Number(chip.dataset.weekday);
    const i = list.indexOf(d);
    if (i === -1) list.push(d); else list.splice(i, 1);
    chip.setAttribute('aria-pressed', i === -1);
    return true;
}

function openGoalDialog(id = null) {
    if (!id && !P.can.createGoals()) {
        openPlans('medio', 'Criar novas metas faz parte do plano Médio. As metas que você já tem continuam funcionando.');
        return;
    }
    const g = id ? goals().find(x => x.id === id) : null;
    const today = todayDate();
    state.editingGoal = g ? g.id : null;
    $('goal-dialog-title').textContent = g ? 'Editar meta' : 'Nova meta';
    $('goal-submit').textContent = g ? 'Salvar' : 'Criar meta';
    $('goal-amount').value = g ? moneyInput(L.num(g.amount)) : '';
    $('goal-name').value = g?.name || '';
    $('goal-start').value = g?.startDate || L.toDateKey(today);
    $('goal-deadline').value = g?.deadline || L.toDateKey(L.getMonthRange(today).end);
    state.goalWeekdays = g ? [...g.weekdays] : L.defaultWorkWeekdays(settings());
    renderWeekdayChips('goal-weekdays', state.goalWeekdays);
    updateGoalPreview();
    $('goal-dialog').showModal();
    if (!g) setTimeout(() => $('goal-amount').focus(), 50);
}

function readGoalForm() {
    return {
        amount: parseDecimal($('goal-amount').value),
        name: $('goal-name').value.trim(),
        startDate: $('goal-start').value,
        deadline: $('goal-deadline').value,
        weekdays: [...state.goalWeekdays]
    };
}

function updateGoalPreview() {
    const f = readGoalForm();
    const el = $('goal-preview');
    if (!(f.amount > 0) || !f.startDate || !f.deadline || !f.weekdays.length) { el.hidden = true; return; }
    el.hidden = false;
    el.classList.remove('warn');

    if (f.deadline < f.startDate) {
        el.classList.add('warn');
        el.innerHTML = '<div>A data final precisa ser depois da data de início.</div>';
        return;
    }
    if (f.deadline < L.toDateKey(todayDate())) {
        el.classList.add('warn');
        el.innerHTML = '<div>A data para bater a meta já passou.</div>';
        return;
    }

    // simula a meta junto com as outras, para considerar a divisão do lucro em cascata
    const draft = { ...(goals().find(g => g.id === state.editingGoal) || {}), ...f, id: state.editingGoal || '__draft__' };
    const others = goals().filter(g => g.id !== draft.id);
    if (!state.editingGoal && L.isManualOrder(others)) draft.priority = insertionPriority(others, draft);
    const { results, combined } = L.evaluateGoals([...others, draft], settings(), state.data.history, new Date());
    const r = results.find(x => x.goal.id === draft.id);
    if (r.status === 'done') {
        el.innerHTML = `<div class="preview-row"><span>Você já fez ${brl(r.net)} nesse período</span><strong>Meta batida</strong></div>`;
        return;
    }
    const rows = r.brutoPorDia > 0
        ? [['Você precisa faturar por dia', `≈ ${brl(r.brutoPorDia)} brutos`], ['Líquido por dia', brl(r.porDia)], ['Rodagem por dia', `≈ ${fmt(r.kmPorDia, 0)} km`]]
        : [['Você precisa fazer por dia', `${brl(r.porDia)} líquidos`]];
    const openCount = results.filter(isOpenGoal).length;
    rows.push(['Dias de trabalho até a data', String(r.diasRestantes)]);
    if (r.net !== 0) rows.push(['Já conta para esta meta', brl(r.net)]);
    if (openCount > 1) {
        rows.push(['Prioridade', `${results.filter(isOpenGoal).indexOf(r) + 1}ª de ${openCount}`]);
        if (combined) rows.push(['Para bater todas as metas', combined.brutoPorDia > 0 ? `≈ ${brl(combined.brutoPorDia)}/dia brutos` : `${brl(combined.porDia)}/dia`]);
    }
    el.innerHTML = rows.map(([k, v]) => `<div class="preview-row"><span>${k}</span><strong>${v}</strong></div>`).join('');
}

function saveGoal(e) {
    e.preventDefault();
    const f = readGoalForm();
    const fail = (msg, id) => { toast(msg, { type: 'error' }); if (id) $(id).focus(); };
    if (!(f.amount > 0)) return fail('Informe quanto quer fazer de lucro líquido.', 'goal-amount');
    if (!f.startDate) return fail('Informe a data de início.', 'goal-start');
    if (!f.deadline) return fail('Informe até quando quer bater a meta.', 'goal-deadline');
    if (f.deadline < f.startDate) return fail('A data final precisa ser depois da data de início.', 'goal-deadline');
    if (!state.editingGoal && f.deadline < L.toDateKey(todayDate())) return fail('A data para bater a meta já passou.', 'goal-deadline');
    if (!f.weekdays.length) return fail('Escolha pelo menos um dia de trabalho.');

    const existing = state.editingGoal && goals().find(g => g.id === state.editingGoal);
    if (existing) {
        Object.assign(existing, f);
    } else {
        const g = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), createdAt: Date.now(), ...f };
        // com prioridade manual, a nova meta entra onde a regra automática a colocaria
        if (L.isManualOrder(goals())) {
            const list = openGoalOrder();
            const at = list.findIndex(x => L.goalAutoCompare(g, x) < 0);
            list.splice(at === -1 ? list.length : at, 0, g);
            savePriorities(list);
        }
        goals().push(g);
    }
    $('goal-dialog').close();
    markChanged(0);
    toast(existing ? 'Meta atualizada.' : 'Meta criada! Acompanhe o progresso na tela Início.');
    const active = document.querySelector('.screen.active')?.id;
    if (active === 'goals-screen') renderGoals();
    else if (active === 'dashboard-screen') renderGoalWidget();
}

async function deleteGoal(id) {
    const idx = goals().findIndex(g => g.id === id);
    if (idx === -1) return;
    const g = goals()[idx];
    const ok = await confirmDialog({
        title: 'Excluir meta?',
        message: `"${goalTitle(g)}" será removida. Seus ganhos lançados não são afetados.`,
        confirmLabel: 'Excluir',
        danger: true
    });
    if (!ok) return;
    goals().splice(idx, 1);
    markChanged();
    renderGoals();
    toast('Meta excluída.', {
        action: 'Desfazer',
        onAction: () => {
            goals().splice(Math.min(idx, goals().length), 0, g);
            markChanged();
            renderGoals();
        }
    });
}

// ═══════════════════════ Ajustes ═══════════════════════
function renderProfile() {
    if (!state.data) return;
    const s = settings();
    const lucroKm = L.num(s.mediaPagamentoKm) - L.num(s.mediaPrecoCombustivel) / L.num(s.mediaConsumoL);
    const rows = [
        ['Meta líquida mensal', brl(L.num(s.metaLiquidaMensal))],
        ['Dias de trabalho', weekdaysLabel(L.workWeekdays(s))],
        ['Meta líquida por dia', brl(L.dailyTarget(s, new Date()))],
        ['Ganho médio por km', brl(L.num(s.mediaPagamentoKm))],
        ['Consumo médio', `${fmt(L.num(s.mediaConsumoL))} km/L`],
        ['Preço do litro', brl(L.num(s.mediaPrecoCombustivel))],
        ['Lucro estimado por km', brl(lucroKm)]
    ];
    if (s.dataInicio) rows.push(['Início no app', fullDate(s.dataInicio)]);
    $('profile-settings').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
    $('profile-platforms').innerHTML = s.plataformas.map(p => `<span class="chip"><span class="plat-dot" style="--c:${platformColor(p)}"></span>${esc(p)}</span>`).join('');
}

function exportBackup() {
    const blob = new Blob([JSON.stringify(state.data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `napista-backup-${L.toDateKey(new Date())}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function handleLogout() {
    if (hasUnsaved()) {
        const ok = await confirmDialog({
            title: 'Sair sem salvar?',
            message: 'Algumas alterações ainda não foram enviadas ao Google Drive e serão perdidas.',
            confirmLabel: 'Sair mesmo assim',
            danger: true
        });
        if (!ok) return;
    }
    logout();
    P.clearPlan();
    clearCache();
    resetSync();
    state.data = null;
    state.fileId = null;
    showScreen('login-screen');
}

async function handleWipe() {
    const ok = await confirmDialog({
        title: 'Apagar todos os dados?',
        message: 'Suas metas, todo o histórico e a Gestão na Pista (contas, cartões e lançamentos) serão apagados do Google Drive permanentemente. Considere baixar um backup antes.',
        confirmLabel: 'Apagar tudo',
        danger: true
    });
    if (!ok) return;
    if (!hasValidToken()) {
        toast('Toque em "Sincronizar" no topo para conectar ao Google e tente de novo.', { type: 'error', duration: 6000 });
        setSync(hasUnsaved() ? 'auth' : 'stale');
        return;
    }

    showLoading('Apagando dados…');
    try {
        clearTimeout(saveTimer);
        if (inflight) await inflight;
        await deleteData(state.fileId);
        resetSync();
        state.fileId = null;
        state.data = normalizeData(L.createDefaultData());
        writeCache();
        state.reportKey = null;
        toast('Dados apagados. Vamos configurar do zero.');
        openSetup();
    } catch (e) {
        console.error(e);
        toast('Não foi possível apagar os dados. Tente novamente.', { type: 'error' });
        showScreen('profile-screen');
    }
}

// ═══════════════════════ Planos e anúncios ═══════════════════════
const PLAN_FEATURES = {
    free: ['Lançamento diário de ganhos, km e gastos', 'Meta mensal definida no cadastro', 'Relatórios por dia, semana e mês', 'Com anúncios'],
    semanuncios: ['Tudo do plano Grátis', 'Sem anúncios'],
    medio: ['Tudo do plano Sem anúncios', 'Criar metas com prazo (IPVA, pneus, férias…)'],
    completo: ['Tudo do plano Médio', 'Gestão na Pista: contas, cartões de crédito, despesas fixas e parceladas, e para onde vai o que você ganha']
};

/** Busca o plano na API (sem abrir popup) e atualiza a tela se mudou. */
function updatePlan() {
    return P.refreshPlan()
        .then(changed => { if (changed) renderPlanUI(); return changed; })
        .catch(e => { console.error('Plano:', e); return false; });
}

function renderPlanUI() {
    renderAds();
    renderPlanCard();
    if ($('plans-dialog').open) renderPlanList();
}

function renderPlanCard() {
    const card = $('plan-card');
    card.hidden = !P.billingEnabled();
    if (card.hidden) return;
    const plan = P.currentPlan();
    const exp = P.planExpiresAt();
    $('plan-badge').textContent = P.planName(plan);
    $('plan-badge').classList.toggle('badge-brand', plan !== 'free');
    if (plan === 'free') {
        $('plan-desc').textContent = 'Com anúncios. Assine para remover os anúncios e criar metas com prazo.';
        $('btn-plans').textContent = 'Ver planos';
    } else {
        const days = Math.ceil((exp - Date.now()) / 86400000);
        const until = `Válido até ${fullDate(L.toDateKey(new Date(exp)))}.`;
        $('plan-desc').textContent = days <= 5 ? `${until} Vence em ${plural(days, 'dia', 'dias')}: renove para não perder o acesso.` : until;
        $('btn-plans').textContent = 'Renovar ou mudar de plano';
    }
}

let adsenseLoaded = false;
function loadAdsense() {
    if (adsenseLoaded) return;
    adsenseLoaded = true;
    const s = document.createElement('script');
    s.async = true;
    s.crossOrigin = 'anonymous';
    s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(P.ADSENSE.client)}`;
    document.head.appendChild(s);
}

const HOUSE_AD = `
    <span class="ad-label">Anúncio</span>
    <div class="ad-house">
        <div><strong>Use o Na Pista sem anúncios</strong><span class="muted small">Por apenas R$ 4,90 por mês.</span></div>
        <button type="button" class="btn btn-soft btn-sm" data-open-plans="semanuncios">Remover</button>
    </div>`;

/** Mostra anúncios só no plano Grátis; preenche apenas os espaços da tela visível. */
function renderAds() {
    const show = P.billingEnabled() && !P.can.noAds();
    document.querySelectorAll('.ad-slot').forEach(el => {
        el.hidden = !show;
        if (!show) { el.innerHTML = ''; delete el.dataset.filled; return; }
        if (el.dataset.filled || !el.closest('.screen.active')) return;
        el.dataset.filled = '1';
        if (P.ADSENSE.client && P.ADSENSE.slot) {
            loadAdsense();
            el.innerHTML = `<span class="ad-label">Publicidade</span>
                <ins class="adsbygoogle" style="display:block" data-ad-client="${esc(P.ADSENSE.client)}" data-ad-slot="${esc(P.ADSENSE.slot)}" data-ad-format="auto" data-full-width-responsive="true"></ins>
                <button type="button" class="link-btn ad-remove" data-open-plans="semanuncios">Remover anúncios</button>`;
            try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (e) { console.error(e); }
        } else {
            el.innerHTML = HOUSE_AD;
        }
    });
}

function openPlans(highlight = null, reason = '') {
    if (!P.billingEnabled()) return;
    state.plansHighlight = highlight;
    $('plans-reason').textContent = reason;
    $('plans-reason').hidden = !reason;
    renderPlanList();
    $('plans-dialog').showModal();
    updatePlan(); // confere se algo mudou (ex.: Pix pago há pouco)
}

function setPlansPeriod(period) {
    state.plansPeriod = period;
    document.querySelectorAll('#plans-period .seg-btn').forEach(b => {
        const on = b.dataset.period === period;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', String(on));
    });
    renderPlanList();
}

function renderPlanList() {
    const cat = P.catalog();
    const cur = P.currentPlan();
    const curRank = cur === 'free' ? 0 : cat[cur]?.rank || 0;
    const period = state.plansPeriod;
    const ids = ['free', ...Object.keys(cat).sort((a, b) => cat[a].rank - cat[b].rank)];

    $('plan-list').innerHTML = ids.map(id => {
        const p = id === 'free' ? { name: 'Grátis', rank: 0, available: true } : cat[id];
        const price = p.periods?.[period];
        const isCurrent = id === cur;
        let priceHtml = '<span class="plan-price">R$ 0</span>';
        if (price) {
            const per = period === 'anual' ? '/ano' : '/mês';
            const monthly = period === 'anual' ? `<span class="plan-eq">equivale a ${brl(price.amount / 12)}/mês</span>` : '';
            priceHtml = `<span class="plan-price">${brl(price.amount)}<small>${per}</small></span>${monthly}`;
        }
        let action = '';
        if (id === 'free') action = '';
        else if (!p.available) action = '<button type="button" class="btn btn-ghost btn-sm" disabled>Em breve</button>';
        else if (p.rank < curRank) action = '<span class="muted small">Incluído no seu plano</span>';
        else action = `<button type="button" class="btn ${isCurrent ? 'btn-soft' : 'btn-primary'} btn-sm" data-buy="${id}">${isCurrent ? 'Renovar' : 'Assinar'}</button>`;

        const classes = ['plan-item', isCurrent && 'is-current', state.plansHighlight === id && 'is-highlight'].filter(Boolean).join(' ');
        return `<article class="${classes}">
            <header class="plan-head">
                <h3>${esc(p.name)}${isCurrent ? ' <span class="badge badge-brand">Atual</span>' : ''}</h3>
                <div class="plan-pricing">${priceHtml}</div>
            </header>
            <ul class="plan-features">${(PLAN_FEATURES[id] || []).map(f => `<li>${esc(f)}</li>`).join('')}</ul>
            ${action ? `<div class="plan-action">${action}</div>` : ''}
        </article>`;
    }).join('');
}

async function buyPlan(btn) {
    if (!navigator.onLine) return toast('Sem internet. Conecte-se para assinar.', { type: 'error' });
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Abrindo…';
    try {
        await P.startCheckout(btn.dataset.buy, state.plansPeriod); // redireciona para o Mercado Pago
    } catch (e) {
        console.error(e);
        if (e?.type !== 'popup_closed') toast(e?.message || 'Não foi possível abrir o pagamento.', { type: 'error' });
        btn.disabled = false;
        btn.textContent = label;
    }
}

/** Volta do Mercado Pago com ?pagamento=ok|pendente|falhou. */
function handlePaymentReturn() {
    const params = new URLSearchParams(location.search);
    const status = params.get('pagamento');
    if (!status) return;
    // limpa os parâmetros que o Mercado Pago adiciona ao endereço
    history.replaceState(null, '', location.pathname);

    if (status === 'falhou') {
        toast('Pagamento não concluído. Nenhum valor foi cobrado.', { type: 'error', duration: 6000 });
        return;
    }
    toast(status === 'ok' ? 'Pagamento recebido! Liberando seu plano…' : 'Pagamento em processamento. Assim que for confirmado, seu plano é liberado.', { duration: 6000 });

    const before = P.currentPlan() + P.planExpiresAt();
    let tries = 0;
    const poll = async () => {
        tries++;
        if (!hasValidToken()) {
            if (tries < 10) return setTimeout(poll, 3000); // aguarda o login carregar
            toast('Toque em "Sincronizar" no topo para atualizar seu plano.', { duration: 6000 });
            return;
        }
        await updatePlan();
        if (P.currentPlan() + P.planExpiresAt() !== before) {
            toast(`Plano ${P.planName(P.currentPlan())} liberado. Obrigado!`, { duration: 5000 });
        } else if (tries < (status === 'ok' ? 15 : 6)) {
            setTimeout(poll, 4000);
        }
    };
    setTimeout(poll, 1500);
}

// ═══════════════════════ Instalar o app (PWA) ═══════════════════════
// O Chrome no Android só mostra o aviso automático de instalação de vez em
// quando (e some por um tempo depois de dispensado ou desinstalado). Guardamos
// o evento para o botão "Instalar" funcionar sempre. O iOS não tem instalação
// automática: mostramos o passo a passo do "Adicionar à Tela de Início".
const INSTALL_NUDGE_KEY = 'napista_install_nudge';
let installPrompt = null;

const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isAndroid = () => /Android/i.test(navigator.userAgent);

function renderInstall() {
    const installed = isStandalone();
    $('install-card').hidden = installed;
    document.querySelectorAll('.install-link').forEach(b => { b.hidden = installed; });
    if (installed) return;
    $('install-desc').textContent = installPrompt
        ? 'Tenha o Na Pista na tela inicial, abrindo em tela cheia como um app.'
        : isIOS()
            ? 'No iPhone, a instalação é feita pelo botão Compartilhar do navegador. Toque abaixo para ver como.'
            : 'Tenha o Na Pista na tela inicial. Toque abaixo para ver como instalar.';
}

async function installApp() {
    if (installPrompt) {
        const ev = installPrompt;
        installPrompt = null;
        try {
            await ev.prompt();
            const { outcome } = await ev.userChoice;
            if (outcome !== 'accepted') toast('Instalação cancelada. Você pode instalar depois em Ajustes.');
        } catch (e) {
            console.error(e);
            openInstallHelp();
        }
        renderInstall();
        return;
    }
    openInstallHelp();
}

function openInstallHelp() {
    let steps, note = '';
    if (isIOS()) {
        steps = [
            'Abra o Na Pista no <strong>Safari</strong> (no iOS 16.4 ou mais novo também funciona no Chrome).',
            'Toque no botão <strong>Compartilhar</strong> (o quadrado com uma seta para cima).',
            'Role e toque em <strong>Adicionar à Tela de Início</strong>.',
            'Toque em <strong>Adicionar</strong>. O ícone aparece na sua tela inicial.'
        ];
        note = 'No app instalado, entre com sua conta Google uma vez: seus dados vêm do Google Drive.';
    } else if (isAndroid()) {
        steps = [
            'Toque no menu <strong>⋮</strong> do Chrome, no canto superior direito.',
            'Escolha <strong>Instalar app</strong> (ou <strong>Adicionar à tela inicial</strong>).',
            'Confirme em <strong>Instalar</strong>.'
        ];
        note = 'Acabou de desinstalar? O Chrome pode levar alguns minutos para liberar a instalação de novo. Se a opção não aparecer, feche e abra o Chrome.';
    } else {
        steps = [
            'No Chrome ou Edge, clique no ícone de <strong>instalar</strong> na barra de endereço (um monitor com uma seta).',
            'Ou abra o menu do navegador e escolha <strong>Instalar Na Pista</strong>.'
        ];
    }
    $('install-steps').innerHTML = steps.map(s => `<li>${s}</li>`).join('');
    $('install-note').textContent = note;
    $('install-note').hidden = !note;
    $('install-dialog').showModal();
}

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // usamos nosso próprio botão em vez da barrinha automática
    installPrompt = e;
    renderInstall();
    // lembrete discreto, no máximo uma vez a cada 14 dias
    let last = 0;
    try { last = Number(localStorage.getItem(INSTALL_NUDGE_KEY)) || 0; } catch { /* ignora */ }
    if (state.data && Date.now() - last > 14 * 86400000) {
        try { localStorage.setItem(INSTALL_NUDGE_KEY, String(Date.now())); } catch { /* ignora */ }
        setTimeout(() => toast('Instale o Na Pista na tela inicial.', { action: 'Instalar', duration: 8000, onAction: installApp }), 2500);
    }
});

window.addEventListener('appinstalled', () => {
    installPrompt = null;
    renderInstall();
    toast('App instalado! Abra pelo ícone na tela inicial.');
});

// ═══════════════════════ Eventos (registrados uma única vez) ═══════════════════════
function bindEvents() {
    // Máscaras e lançamentos do dia (delegação: funciona para inputs criados dinamicamente)
    document.addEventListener('input', (e) => {
        const t = e.target;
        if (t.classList.contains('money')) maskMoney(t);
        else if (t.classList.contains('decimal')) maskDecimal(t);
        else if (t.classList.contains('integer')) t.value = t.value.replace(/\D/g, '');

        if (t.classList.contains('day-input')) commitDayForm();
        if (t.closest('#setup-form')) updateSetupPreview();
        if (t.closest('#goal-form')) updateGoalPreview();
    });

    $('btn-login').addEventListener('click', handleLogin);
    document.addEventListener('click', (e) => { if (e.target.closest('[data-install]')) installApp(); });

    // Planos
    $('btn-plans').addEventListener('click', () => openPlans());
    document.querySelectorAll('#plans-period .seg-btn').forEach(b => b.addEventListener('click', () => setPlansPeriod(b.dataset.period)));
    $('plan-list').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-buy]');
        if (btn) buyPlan(btn);
    });
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-open-plans]');
        if (btn) openPlans(btn.dataset.openPlans);
    });

    // Setup
    $('setup-form').addEventListener('submit', saveSetup);
    $('btn-cancel-setup').addEventListener('click', () => showScreen('profile-screen'));
    $('btn-add-app').addEventListener('click', addCustomPlatform);
    $('setup-other-app').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); addCustomPlatform(); }
    });
    $('setup-platforms').addEventListener('click', (e) => {
        const chip = e.target.closest('[data-platform]');
        if (!chip) return;
        const p = chip.dataset.platform;
        const i = state.setupPlatforms.indexOf(p);
        if (i === -1) state.setupPlatforms.push(p); else state.setupPlatforms.splice(i, 1);
        chip.setAttribute('aria-pressed', i === -1);
    });

    $('setup-weekdays').addEventListener('click', (e) => {
        if (toggleWeekday(e, state.setupWeekdays)) updateSetupPreview();
    });

    // Navegação inferior (Na Pista e Gestão)
    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.addEventListener('click', () => showScreen(btn.dataset.target));
    });
    $('btn-switch-mode').addEventListener('click', switchMode);
    gestao.bind();

    // Dashboard
    document.querySelectorAll('#scope-seg .seg-btn').forEach(btn => {
        btn.addEventListener('click', () => setScope(btn.dataset.scope));
    });
    $('btn-prev-date').addEventListener('click', () => navigateDate(-1));
    $('btn-next-date').addEventListener('click', () => navigateDate(1));
    $('btn-today').addEventListener('click', () => setAnchor(todayDate()));
    $('btn-date-picker').addEventListener('click', (e) => {
        if (e.target.id !== 'date-picker') openDatePicker();
    });
    $('date-picker').addEventListener('change', (e) => {
        if (e.target.value) setAnchor(L.parseDateKey(e.target.value));
    });
    $('hero-fix').addEventListener('click', openSetup);

    $('btn-add-expense').addEventListener('click', () => openExpenseDialog());
    $('expense-list').addEventListener('click', (e) => {
        const edit = e.target.closest('[data-edit]');
        const del = e.target.closest('[data-del]');
        if (edit) openExpenseDialog(Number(edit.dataset.edit));
        if (del) removeExpense(Number(del.dataset.del));
    });
    $('expense-form').addEventListener('submit', saveExpense);
    $('expense-suggestions').addEventListener('click', (e) => {
        const chip = e.target.closest('[data-suggest]');
        if (!chip) return;
        $('expense-desc').value = chip.dataset.suggest;
        $('expense-val').focus();
    });

    // Metas
    $('btn-create-goal').addEventListener('click', () => openGoalDialog());
    $('btn-new-goal').addEventListener('click', () => openGoalDialog());
    $('btn-new-goal-empty').addEventListener('click', () => openGoalDialog());
    $('goal-widget-body').addEventListener('click', (e) => {
        if (e.target.closest('[data-goto-goals]')) showScreen('goals-screen');
    });
    $('goals-list').addEventListener('click', (e) => {
        const edit = e.target.closest('[data-goal-edit]');
        const del = e.target.closest('[data-goal-del]');
        const move = e.target.closest('[data-goal-move]');
        if (edit) openGoalDialog(edit.dataset.goalEdit);
        if (del) deleteGoal(del.dataset.goalDel);
        if (move) moveGoal(move.dataset.goalMove, Number(move.dataset.dir));
        if (e.target.closest('[data-goal-auto]')) resetGoalOrder();
    });
    $('goal-form').addEventListener('submit', saveGoal);
    $('goal-form').addEventListener('change', (e) => {
        if (e.target.type === 'date') updateGoalPreview();
    });
    $('goal-weekdays').addEventListener('click', (e) => {
        if (toggleWeekday(e, state.goalWeekdays)) updateGoalPreview();
    });

    // Relatórios
    document.querySelectorAll('#report-seg .seg-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            state.reportTab = btn.dataset.tab;
            state.reportKey = null;
            state.reportLimit = 5;
            renderReports();
        });
    });
    $('report-list').addEventListener('click', (e) => {
        const row = e.target.closest('[data-group]');
        if (!row) return;
        state.reportKey = row.dataset.group;
        renderReports();
        $('rep-period').scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    $('range-form').addEventListener('submit', (e) => {
        e.preventDefault();
        let start = $('range-start').value;
        let end = $('range-end').value;
        if (!start || !end) { toast('Escolha as duas datas.', { type: 'error' }); return; }
        if (start > end) [start, end] = [end, start];
        state.range = { start, end };
        state.reportLimit = 5;
        renderReports();
    });
    $('rep-exp-btn').addEventListener('click', openReportExpenses);
    $('btn-report-more').addEventListener('click', () => {
        state.reportLimit += 5;
        renderReports();
    });

    // Ajustes
    $('btn-edit-goals').addEventListener('click', openSetup);
    $('btn-export').addEventListener('click', exportBackup);
    $('btn-logout').addEventListener('click', handleLogout);
    $('btn-wipe').addEventListener('click', handleWipe);

    // Diálogos: botões [data-close] e clique fora
    document.querySelectorAll('dialog').forEach(dlg => {
        dlg.addEventListener('click', (e) => {
            if (e.target === dlg) dlg.close();
            if (e.target.closest('[data-close]')) dlg.close();
        });
    });

    // Sincronização
    $('sync-pill').addEventListener('click', () => {
        if (!state.data) return;
        if (needsSync() || !hasValidToken()) syncNow(); // dentro do clique: permite renovar o login
        else toast('Tudo salvo no seu Google Drive.');
    });
    // Token expirado com algo para sincronizar: aproveita o primeiro toque no
    // menu para renovar (popup rápido que fecha sozinho), uma vez por abertura.
    document.addEventListener('click', (e) => {
        if (autoRenewTried || !state.data || !isAuthReady() || hasValidToken() || !navigator.onLine) return;
        if (!hasUnsaved()) return;
        // só no menu inferior, para não atrapalhar ações como "Criar meta"
        if (!e.target.closest('.nav-item')) return;
        autoRenewTried = true;
        syncNow();
    }, true);
    window.addEventListener('online', () => { if (needsSync()) syncWithDrive(); });
    window.addEventListener('offline', () => { if (hasUnsaved()) setSync('offline'); });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden' && hasUnsaved() && hasValidToken()) flushSave();
        if (document.visibilityState === 'visible' && state.data) {
            // busca alterações feitas em outro aparelho
            if (hasValidToken() && (hasUnsaved() || Date.now() - lastPull > PULL_INTERVAL_MS)) syncWithDrive();
            // ao voltar ao app num novo dia, atualiza o "hoje"
            if ($('dashboard-screen').classList.contains('active')) { renderDateNav(); renderGoalWidget(); }
            else gestao.rerender();
        }
    });
}

// Erros inesperados aparecem na tela em vez de o botão simplesmente "não fazer nada"
window.addEventListener('error', (e) => toast(`Erro inesperado: ${e.message || 'desconhecido'}. Recarregue o app.`, { type: 'error', duration: 8000 }));
window.addEventListener('unhandledrejection', (e) => console.error('Promise rejeitada:', e.reason));

const gestao = createGestao({
    $, brl, esc, toast, confirmDialog, choiceDialog, parseDecimal, moneyInput,
    data: () => state.data,
    markChanged,
    showScreen,
    openNaPistaDay,
    leave: () => showScreen('dashboard-screen')
});

bindEvents();
renderInstall();
boot();
handlePaymentReturn();
